import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { updateProviderSchema } from '@/lib/validation/provider';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/providers/[id] - Get Provider Profile
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:read');
  const providerId = context?.params.id;

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const { searchParams } = new URL(req.url);
  const revealSsn = searchParams.get('revealSsn') === 'true';

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      specialties: {
        include: { taxonomy: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      locations: {
        include: { location: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      stateLicenses: {
        orderBy: { expirationDate: 'asc' },
      },
      deaRegistrations: {
        orderBy: { expirationDate: 'asc' },
      },
      boardCertifications: {
        orderBy: { expirationDate: 'asc' },
      },
      malpracticePolicies: {
        orderBy: { expirationDate: 'asc' },
      },
      caqhProfile: true,
      enrollments: {
        include: {
          payer: true,
          location: true,
          assignedTo: { select: { firstName: true, lastName: true } },
        },
        orderBy: { updatedAt: 'desc' },
      },
      verificationHistory: {
        orderBy: { verifiedDate: 'desc' },
        take: 10,
      },
    },
  });

  if (!provider) {
    throw ApiError.notFound('Provider not found.');
  }

  // Fetch recent audit logs for this provider
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: 'provider',
      entityId: providerId,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  // Fetch tasks for this provider and their credentials
  const allCredentialIds = [
    ...provider.stateLicenses.map((l) => l.id),
    ...provider.deaRegistrations.map((d) => d.id),
    ...provider.boardCertifications.map((b) => b.id),
    ...provider.malpracticePolicies.map((m) => m.id),
    ...(provider.caqhProfile ? [provider.caqhProfile.id] : []),
  ];

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { entityId: providerId },
        { entityId: { in: allCredentialIds } },
      ],
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });

  // Handle SSN masking and decryption
  let ssnDisplay: string | null = null;
  if (provider.ssnEncrypted) {
    if (revealSsn) {
      try {
        ssnDisplay = decrypt(Buffer.from(provider.ssnEncrypted));
        // Audit sensitive data access
        await logAuditEvent({
          userId: session.userId,
          userEmail: session.email,
          action: 'view_sensitive_ssn',
          entityType: 'provider',
          entityId: provider.id,
        });
      } catch (err) {
        console.error('Failed to decrypt SSN:', err);
        ssnDisplay = '***-**-ERROR';
      }
    } else {
      // Masked SSN format
      try {
        const fullSsn = decrypt(Buffer.from(provider.ssnEncrypted));
        const last4 = fullSsn.replace(/\D/g, '').slice(-4);
        ssnDisplay = `***-**-${last4 || '****'}`;
      } catch {
        ssnDisplay = '***-**-****';
      }
    }
  }

  const safeProvider = {
    ...provider,
    ssn: ssnDisplay,
    hasSsn: Boolean(provider.ssnEncrypted),
  };
  delete (safeProvider as { ssnEncrypted?: unknown }).ssnEncrypted;

  return NextResponse.json({
    provider: safeProvider,
    auditHistory: auditLogs,
    tasks,
  });
});

// PATCH /api/v1/providers/[id] - Update Provider
export const PATCH = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = context?.params.id;

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const existingProvider = await prisma.provider.findUnique({
    where: { id: providerId },
  });
  if (!existingProvider) {
    throw ApiError.notFound('Provider not found.');
  }

  const body = await req.json();
  const parsed = updateProviderSchema.parse(body);

  // If NPI is being updated, verify uniqueness
  if (parsed.npiNumber && parsed.npiNumber !== existingProvider.npiNumber) {
    const duplicate = await prisma.provider.findUnique({
      where: { npiNumber: parsed.npiNumber },
    });
    if (duplicate) {
      throw ApiError.conflict(`NPI ${parsed.npiNumber} is already assigned to another provider.`);
    }
  }

  // Prepare updates and changes for audit log
  const dataToUpdate: Record<string, unknown> = {};
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  const fieldsToCheck = [
    'firstName',
    'middleName',
    'lastName',
    'suffix',
    'gender',
    'email',
    'phone',
    'npiNumber',
    'npiType',
    'primaryTaxonomy',
    'taxonomyDescription',
    'caqhId',
    'status',
    'credentialingStatus',
    'notes',
  ] as const;

  for (const field of fieldsToCheck) {
    if (parsed[field] !== undefined && parsed[field] !== (existingProvider as Record<string, unknown>)[field]) {
      changes[field] = {
        old: (existingProvider as Record<string, unknown>)[field],
        new: parsed[field],
      };
      dataToUpdate[field] = parsed[field];
    }
  }

  if (parsed.dateOfBirth !== undefined) {
    dataToUpdate.dateOfBirth = parsed.dateOfBirth;
    changes['dateOfBirth'] = {
      old: existingProvider.dateOfBirth,
      new: parsed.dateOfBirth,
    };
  }

  if (parsed.npiEnumerationDate !== undefined) {
    dataToUpdate.npiEnumerationDate = parsed.npiEnumerationDate;
  }

  if (parsed.ssn !== undefined) {
    if (parsed.ssn) {
      dataToUpdate.ssnEncrypted = encrypt(parsed.ssn);
      changes['ssn'] = { old: '[ENCRYPTED]', new: '[UPDATED_ENCRYPTED]' };
    } else {
      dataToUpdate.ssnEncrypted = null;
      changes['ssn'] = { old: '[ENCRYPTED]', new: null };
    }
  }

  const updatedProvider = await prisma.provider.update({
    where: { id: providerId },
    data: dataToUpdate,
    include: {
      specialties: { include: { taxonomy: true } },
      locations: { include: { location: true } },
    },
  });

  // Record audit log entry
  if (Object.keys(changes).length > 0) {
    await logAuditEvent({
      userId: session.userId,
      userEmail: session.email,
      action: 'update_provider',
      entityType: 'provider',
      entityId: providerId,
      changes,
    });
  }

  const safeUpdated = { ...updatedProvider };
  delete (safeUpdated as { ssnEncrypted?: unknown }).ssnEncrypted;

  return NextResponse.json({
    provider: safeUpdated,
    message: 'Provider updated successfully.',
  });
});

// DELETE /api/v1/providers/[id] - Archive Provider
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'providers:write');
  const providerId = context?.params.id;

  if (!providerId) {
    throw ApiError.badRequest('Provider ID is required.');
  }

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
  });
  if (!provider) {
    throw ApiError.notFound('Provider not found.');
  }

  // Soft-delete: status = 'archived'
  const archived = await prisma.provider.update({
    where: { id: providerId },
    data: { status: 'archived' },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'archive_provider',
    entityType: 'provider',
    entityId: providerId,
    changes: {
      status: { old: provider.status, new: 'archived' },
    },
  });

  return NextResponse.json({
    success: true,
    message: `Provider ${archived.firstName} ${archived.lastName} has been archived.`,
  });
});
