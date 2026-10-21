import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { verifyCredentialSchema } from '@/lib/validation/credential';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    type: string;
    id: string;
  };
}

// POST /api/v1/credentials/[type]/[id]/verify - Record Primary Source Verification
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'credentials:write');
  const { type, id } = context!.params;
  const body = await req.json();

  const validated = verifyCredentialSchema.parse({
    ...body,
    entityType: type,
    entityId: id,
  });

  // Verify provider exists
  const provider = await prisma.provider.findUnique({
    where: { id: validated.providerId },
  });
  if (!provider) {
    throw ApiError.notFound('Provider not found.');
  }

  const now = new Date();
  const isVerifiedSuccess = validated.status === 'verified';

  // 1. Create verification history record
  const history = await prisma.verificationHistory.create({
    data: {
      entityType: type,
      entityId: id,
      providerId: validated.providerId,
      method: validated.method,
      source: validated.source,
      status: validated.status,
      verifiedDate: now,
      expirationDate: validated.expirationDate ? new Date(validated.expirationDate) : null,
      notes: validated.notes,
      verifiedById: session.userId,
    },
  });

  // 2. Update the parent credential record's verification flags
  switch (type) {
    case 'state_license':
      await prisma.stateLicense.update({
        where: { id },
        data: {
          verified: isVerifiedSuccess,
          verifiedAt: isVerifiedSuccess ? now : null,
          verifiedById: isVerifiedSuccess ? session.userId : null,
        },
      });
      break;
    case 'dea_registration':
      await prisma.deaRegistration.update({
        where: { id },
        data: {
          verified: isVerifiedSuccess,
          verifiedAt: isVerifiedSuccess ? now : null,
          verifiedById: isVerifiedSuccess ? session.userId : null,
        },
      });
      break;
    case 'board_certification':
      await prisma.boardCertification.update({
        where: { id },
        data: {
          verified: isVerifiedSuccess,
          verifiedAt: isVerifiedSuccess ? now : null,
          verifiedById: isVerifiedSuccess ? session.userId : null,
        },
      });
      break;
    case 'malpractice_insurance':
      await prisma.malpracticeInsurance.update({
        where: { id },
        data: {
          verified: isVerifiedSuccess,
          verifiedAt: isVerifiedSuccess ? now : null,
          verifiedById: isVerifiedSuccess ? session.userId : null,
        },
      });
      break;
    case 'caqh_profile':
      await prisma.caqhProfile.update({
        where: { id },
        data: {
          attestationStatus: isVerifiedSuccess ? 'current' : 'pending',
          lastAttestationDate: now,
        },
      });
      break;
    default:
      throw ApiError.badRequest(`Unsupported credential type for verification: ${type}`);
  }

  // 3. Log audit event
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'CREDENTIAL_VERIFIED',
    entityType: type,
    entityId: id,
    changes: {
      verificationStatus: validated.status,
      source: validated.source,
      method: validated.method,
    },
  });

  return NextResponse.json(
    {
      message: 'Credential verification logged successfully',
      verification: history,
    },
    { status: 201 }
  );
});
