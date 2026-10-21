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

  // Encrypt SSN if provided (AES-256-GCM)
  let ssnEncrypted: Buffer | undefined = undefined;
  if (parsed.ssn) {
    ssnEncrypted = encrypt(parsed.ssn);
  }

  // Create provider with relations in a transaction
  const newProvider = await prisma.$transaction(async (tx) => {
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

    return provider;
  });

  // Record audit log
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
