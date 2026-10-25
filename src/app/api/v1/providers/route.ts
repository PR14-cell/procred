import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { createProviderSchema } from '@/lib/validation/provider';
import { encrypt } from '@/lib/encryption/aes';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

// GET /api/v1/providers - Search, Filter, Sort, Paginate
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'providers:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() || '';
  const status = searchParams.get('status')?.trim() || '';
  const credentialingStatus = searchParams.get('credentialingStatus')?.trim() || '';
  const taxonomy = searchParams.get('taxonomy')?.trim() || '';
  const locationId = searchParams.get('locationId')?.trim() || '';
  const organizationId = searchParams.get('organizationId')?.trim() || '';
  const sortBy = searchParams.get('sortBy')?.trim() || 'createdAt';
  const sortOrder = searchParams.get('sortOrder')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
  const skip = (page - 1) * limit;

  const where: Prisma.ProviderWhereInput = {};

  // Status filtering
  if (status && status !== 'all') {
    where.status = status;
  } else if (!status) {
    // By default, exclude archived providers from standard view unless explicitly requested
    where.status = { not: 'archived' };
  }

  // Credentialing status filtering
  if (credentialingStatus && credentialingStatus !== 'all') {
    where.credentialingStatus = credentialingStatus;
  }

  // Taxonomy / Specialty filtering
  if (taxonomy) {
    where.OR = [
      { primaryTaxonomy: taxonomy },
      {
        specialties: {
          some: {
            taxonomyCode: taxonomy,
          },
        },
      },
    ];
  }

  // Location filtering
  if (locationId) {
    where.locations = {
      some: {
        locationId,
      },
    };
  }

  // Organization filtering
  if (organizationId) {
    where.organizations = {
      some: {
        organizationId,
      },
    };
  }

  // Search keyword across name, NPI, email, phone
  if (search) {
    where.AND = [
      {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { npiNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      },
    ];
  }

  // Sorting
  const validSortFields: Record<string, string> = {
    name: 'lastName',
    npi: 'npiNumber',
    status: 'status',
    credentialingStatus: 'credentialingStatus',
    createdAt: 'createdAt',
  };
  const sortField = validSortFields[sortBy] || 'createdAt';
  const orderBy: Prisma.ProviderOrderByWithRelationInput = {
    [sortField]: sortOrder,
  };

  const [total, providers] = await Promise.all([
    prisma.provider.count({ where }),
    prisma.provider.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        specialties: {
          include: {
            taxonomy: true,
          },
        },
        locations: {
          include: {
            location: true,
          },
        },
        organizations: {
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                dbaName: true,
                npiNumber: true,
              },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            stateLicenses: true,
            deaRegistrations: true,
            boardCertifications: true,
            malpracticePolicies: true,
            enrollments: true,
          },
        },
      },
    }),
  ]);

  // Strip encrypted SSN from list response for security
  const sanitizedProviders = providers.map((p) => {
    const copy = { ...p, hasSsn: Boolean(p.ssnEncrypted) };
    delete (copy as { ssnEncrypted?: unknown }).ssnEncrypted;
    return copy;
  });

  return NextResponse.json({
    providers: sanitizedProviders,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

// POST /api/v1/providers - Create Provider
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'providers:write');

  const body = await req.json();
  const parsed = createProviderSchema.parse(body);

  // Check NPI uniqueness
  const existingNpi = await prisma.provider.findUnique({
    where: { npiNumber: parsed.npiNumber },
  });
  if (existingNpi) {
    throw ApiError.conflict(`Provider with NPI ${parsed.npiNumber} already exists.`);
  }

  // Encrypt SSN if provided (AES-256-GCM) with context
  let ssnEncrypted: Buffer | undefined = undefined;
  if (parsed.ssn) {
    ssnEncrypted = encrypt(parsed.ssn, 'provider.ssn');
  }

  // Normalize payors from payerEnrollments and/or payerIds
  const rawPayerList: Array<{
    payerId: string;
    enrollmentType?: 'individual' | 'group';
    applicationType?: string;
    status?: string;
    notes?: string | null;
    locationId?: string | null;
  }> = [];

  if (parsed.payerEnrollments && parsed.payerEnrollments.length > 0) {
    rawPayerList.push(...parsed.payerEnrollments);
  }

  if (parsed.payerIds && parsed.payerIds.length > 0) {
    for (const id of parsed.payerIds) {
      if (!rawPayerList.some((p) => p.payerId === id)) {
        rawPayerList.push({ payerId: id });
      }
    }
  }

  // Deduplicate by payerId
  const uniquePayersMap = new Map<string, (typeof rawPayerList)[0]>();
  for (const item of rawPayerList) {
    if (!uniquePayersMap.has(item.payerId)) {
      uniquePayersMap.set(item.payerId, item);
    }
  }
  const uniquePayers = Array.from(uniquePayersMap.values());

  const createdEnrollmentsList: Array<{ id: string; payerId: string }> = [];

  // Create provider with relations in a transaction
  const newProvider = await prisma.$transaction(async (tx) => {
    // If payors are specified, validate they exist in database
    if (uniquePayers.length > 0) {
      const payerIds = uniquePayers.map((p) => p.payerId);
      const foundPayers = await tx.payer.findMany({
        where: { id: { in: payerIds } },
        select: { id: true, name: true, isActive: true },
      });

      if (foundPayers.length !== payerIds.length) {
        const foundIdSet = new Set(foundPayers.map((p) => p.id));
        const missing = payerIds.filter((id) => !foundIdSet.has(id));
        throw ApiError.badRequest(`One or more selected payors do not exist: ${missing.join(', ')}`);
      }
    }

    const provider = await tx.provider.create({
      data: {
        firstName: parsed.firstName,
        middleName: parsed.middleName || null,
        lastName: parsed.lastName,
        suffix: parsed.suffix || null,
        dateOfBirth: parsed.dateOfBirth,
        ssnEncrypted,
        gender: parsed.gender || null,
        email: parsed.email || null,
        phone: parsed.phone || null,
        npiNumber: parsed.npiNumber,
        npiType: parsed.npiType,
        npiEnumerationDate: parsed.npiEnumerationDate,
        primaryTaxonomy: parsed.primaryTaxonomy || null,
        taxonomyDescription: parsed.taxonomyDescription || null,
        caqhId: parsed.caqhId || null,
        status: parsed.status,
        credentialingStatus: parsed.credentialingStatus,
        notes: parsed.notes || null,
      },
    });

    // Create specialties (M:M join table)
    if (parsed.specialties && parsed.specialties.length > 0) {
      await tx.providerSpecialty.createMany({
        data: parsed.specialties.map((s) => ({
          providerId: provider.id,
          taxonomyCode: s.taxonomyCode,
          isPrimary: s.isPrimary ?? false,
        })),
        skipDuplicates: true,
      });
    }

    // Create locations (M:M join table)
    if (parsed.locationIds && parsed.locationIds.length > 0) {
      await tx.providerLocation.createMany({
        data: parsed.locationIds.map((l) => ({
          providerId: provider.id,
          locationId: l.locationId,
          isPrimary: l.isPrimary ?? false,
        })),
        skipDuplicates: true,
      });
    }

    // Handle organization affiliation during provider creation
    let targetOrgId: string | null = null;
    let targetOrgNpi: string | null = null;

    if (parsed.organizationAffiliation && parsed.organizationAffiliation.mode !== 'none') {
      const aff = parsed.organizationAffiliation;

      if (aff.mode === 'new' && aff.newOrganization) {
        // If NPI provided, check for existing organization to avoid duplicates
        if (aff.newOrganization.npiNumber && aff.newOrganization.npiNumber.trim() !== '') {
          const existingOrg = await tx.organization.findUnique({
            where: { npiNumber: aff.newOrganization.npiNumber.trim() },
          });
          if (existingOrg) {
            targetOrgId = existingOrg.id;
            targetOrgNpi = existingOrg.npiNumber;
          }
        }

        if (!targetOrgId) {
          let taxIdEncrypted: Buffer | null = null;
          let taxIdLastFour: string | null = null;
          if (aff.newOrganization.taxId && aff.newOrganization.taxId.trim() !== '') {
            const cleanTin = aff.newOrganization.taxId.trim();
            taxIdLastFour = cleanTin.replace(/\D/g, '').slice(-4);
            taxIdEncrypted = encrypt(cleanTin, 'organization.taxId');
          }

          const createdOrg = await tx.organization.create({
            data: {
              name: aff.newOrganization.name.trim(),
              dbaName: aff.newOrganization.dbaName ? aff.newOrganization.dbaName.trim() : null,
              npiNumber:
                aff.newOrganization.npiNumber && aff.newOrganization.npiNumber.trim() !== ''
                  ? aff.newOrganization.npiNumber.trim()
                  : null,
              taxIdEncrypted,
              taxIdLastFour,
              organizationType: aff.newOrganization.organizationType || 'medical_group',
              address1: aff.newOrganization.address1.trim(),
              city: aff.newOrganization.city.trim(),
              state: aff.newOrganization.state.trim().toUpperCase(),
              zipCode: aff.newOrganization.zipCode.trim(),
              phone: aff.newOrganization.phone ? aff.newOrganization.phone.trim() : null,
              email: aff.newOrganization.email ? aff.newOrganization.email.trim() : null,
              status: 'active',
            },
          });
          targetOrgId = createdOrg.id;
          targetOrgNpi = createdOrg.npiNumber;
        }
      } else if (aff.mode === 'existing' && aff.organizationId) {
        const existingOrg = await tx.organization.findUnique({
          where: { id: aff.organizationId },
        });
        if (!existingOrg) {
          throw ApiError.badRequest('Selected organization does not exist.');
        }
        targetOrgId = existingOrg.id;
        targetOrgNpi = existingOrg.npiNumber;
      }

      if (targetOrgId) {
        await tx.providerOrganization.create({
          data: {
            providerId: provider.id,
            organizationId: targetOrgId,
            isPrimary: aff.isPrimary ?? true,
            employmentType: aff.employmentType || null,
          },
        });
      }
    } else if (parsed.organizationIds && parsed.organizationIds.length > 0) {
      for (const orgItem of parsed.organizationIds) {
        await tx.providerOrganization.create({
          data: {
            providerId: provider.id,
            organizationId: orgItem.organizationId,
            isPrimary: orgItem.isPrimary ?? false,
            employmentType: orgItem.employmentType || null,
          },
        });
      }
    }

    // Create payer enrollments using existing Phase 4 model
    if (uniquePayers.length > 0) {
      for (const item of uniquePayers) {
        // Prevent duplicate enrollments for this provider and payer
        const existingEnrollment = await tx.payerEnrollment.findFirst({
          where: {
            providerId: provider.id,
            payerId: item.payerId,
          },
        });

        if (existingEnrollment) {
          // Preserve existing enrollment data without overwriting
          continue;
        }

        const enrollment = await tx.payerEnrollment.create({
          data: {
            providerId: provider.id,
            payerId: item.payerId,
            locationId: item.locationId || null,
            organizationId: item.enrollmentType === 'group' ? targetOrgId : null,
            groupNpi: item.enrollmentType === 'group' ? targetOrgNpi : null,
            enrollmentType: item.enrollmentType || 'individual',
            applicationType: item.applicationType || 'initial',
            status: item.status || 'not_started',
            notes: item.notes || null,
            assignedToId: session.userId,
            createdById: session.userId,
          },
        });

        await tx.enrollmentStatusHistory.create({
          data: {
            enrollmentId: enrollment.id,
            previousStatus: null,
            newStatus: item.status || 'not_started',
            changedById: session.userId,
            notes: 'Initial enrollment application created during provider onboarding',
          },
        });

        createdEnrollmentsList.push({ id: enrollment.id, payerId: enrollment.payerId });
      }
    }

    return provider;
  });

  // Record audit log for provider creation
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'create_provider',
    entityType: 'provider',
    entityId: newProvider.id,
    changes: {
      firstName: { new: newProvider.firstName },
      lastName: { new: newProvider.lastName },
      npiNumber: { new: newProvider.npiNumber },
      status: { new: newProvider.status },
    },
  });

  // Record audit log for each created enrollment
  for (const enr of createdEnrollmentsList) {
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'ENROLLMENT_CREATED',
      entityType: 'payer_enrollment',
      entityId: enr.id,
      metadata: {
        providerId: newProvider.id,
        payerId: enr.payerId,
        source: 'provider_onboarding',
      },
    });
  }

  // Fetch created provider with relations
  const fullProvider = await prisma.provider.findUnique({
    where: { id: newProvider.id },
    include: {
      specialties: {
        include: { taxonomy: true },
      },
      locations: {
        include: { location: true },
      },
      organizations: {
        include: { organization: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      enrollments: {
        include: { payer: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return NextResponse.json(
    {
      provider: fullProvider,
      message: 'Provider created successfully.',
    },
    { status: 201 }
  );
});
