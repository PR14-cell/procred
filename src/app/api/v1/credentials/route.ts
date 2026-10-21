import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { encrypt } from '@/lib/encryption/aes';
import {
  getUnifiedCredentials,
  CredentialFilterOptions,
} from '@/lib/credentials/credential-service';
import {
  createStateLicenseSchema,
  createDeaSchema,
  createBoardCertSchema,
  createMalpracticeSchema,
  createCaqhSchema,
  CredentialType,
} from '@/lib/validation/credential';

export const dynamic = 'force-dynamic';

// GET /api/v1/credentials - Global Credential Work Queue & Filter API
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'credentials:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const providerId = searchParams.get('providerId') || undefined;
  const credentialType = (searchParams.get('credentialType') as CredentialFilterOptions['credentialType']) || 'all';
  const state = searchParams.get('state') || undefined;
  const status = searchParams.get('status') || undefined;
  const expirationWindow = (searchParams.get('expirationWindow') as CredentialFilterOptions['expirationWindow']) || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const sortBy = (searchParams.get('sortBy') as CredentialFilterOptions['sortBy']) || 'expirationDate';
  const sortOrder = (searchParams.get('sortOrder') as CredentialFilterOptions['sortOrder']) || 'asc';

  const result = await getUnifiedCredentials({
    search,
    providerId,
    credentialType,
    state,
    status,
    expirationWindow,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  return NextResponse.json(result);
});

// POST /api/v1/credentials - Create any credential type
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'credentials:write');
  const body = await req.json();

  const credentialType = body.credentialType as CredentialType;
  if (!credentialType) {
    throw ApiError.badRequest('Field "credentialType" is required.');
  }

  // Ensure provider exists
  const provider = await prisma.provider.findUnique({
    where: { id: body.providerId },
  });
  if (!provider) {
    throw ApiError.notFound('Referenced provider does not exist.');
  }

  let createdRecord: unknown = null;
  let identifier = '';

  switch (credentialType) {
    case 'state_license': {
      const data = createStateLicenseSchema.parse(body);
      const lic = await prisma.stateLicense.create({
        data: {
          providerId: data.providerId,
          state: data.state,
          licenseNumber: data.licenseNumber,
          licenseType: data.licenseType,
          status: data.status,
          issueDate: data.issueDate ? new Date(data.issueDate) : null,
          expirationDate: new Date(data.expirationDate),
        },
      });
      createdRecord = lic;
      identifier = lic.licenseNumber;
      break;
    }

    case 'dea_registration': {
      const data = createDeaSchema.parse(body);
      const dea = await prisma.deaRegistration.create({
        data: {
          providerId: data.providerId,
          deaNumber: data.deaNumber,
          schedule: data.schedule,
          state: data.state,
          status: data.status,
          issueDate: data.issueDate ? new Date(data.issueDate) : null,
          expirationDate: new Date(data.expirationDate),
        },
      });
      createdRecord = dea;
      identifier = dea.deaNumber;
      break;
    }

    case 'board_certification': {
      const data = createBoardCertSchema.parse(body);
      const board = await prisma.boardCertification.create({
        data: {
          providerId: data.providerId,
          boardName: data.boardName,
          specialty: data.specialty,
          certificationNumber: data.certificationNumber,
          status: data.status,
          initialCertDate: data.initialCertDate ? new Date(data.initialCertDate) : null,
          expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
        },
      });
      createdRecord = board;
      identifier = board.boardName;
      break;
    }

    case 'malpractice_insurance': {
      const data = createMalpracticeSchema.parse(body);
      const mal = await prisma.malpracticeInsurance.create({
        data: {
          providerId: data.providerId,
          carrierName: data.carrierName,
          policyNumber: data.policyNumber,
          coverageType: data.coverageType,
          perClaimAmount: data.perClaimAmount ? data.perClaimAmount : null,
          aggregateAmount: data.aggregateAmount ? data.aggregateAmount : null,
          effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
          expirationDate: new Date(data.expirationDate),
          retroactiveDate: data.retroactiveDate ? new Date(data.retroactiveDate) : null,
          status: data.status,
        },
      });
      createdRecord = mal;
      identifier = mal.policyNumber || mal.carrierName;
      break;
    }

    case 'caqh_profile': {
      const data = createCaqhSchema.parse(body);
      const passwordEncrypted = data.password ? encrypt(data.password) : null;
      const caqh = await prisma.caqhProfile.create({
        data: {
          providerId: data.providerId,
          caqhId: data.caqhId,
          username: data.username,
          passwordEncrypted,
          lastAttestationDate: data.lastAttestationDate ? new Date(data.lastAttestationDate) : null,
          nextAttestationDate: new Date(data.nextAttestationDate),
          attestationStatus: data.attestationStatus,
          reauthorizationDate: data.reauthorizationDate ? new Date(data.reauthorizationDate) : null,
        },
      });
      createdRecord = caqh;
      identifier = caqh.caqhId;
      break;
    }

    default:
      throw ApiError.badRequest(`Unsupported credential type: ${credentialType}`);
  }

  // Audit Log
  const recordWithId = createdRecord as { id: string };
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'CREDENTIAL_CREATED',
    entityType: credentialType,
    entityId: recordWithId.id,
    changes: {
      providerId: body.providerId,
      credentialType,
      identifier,
    },
  });

  return NextResponse.json(
    {
      message: 'Credential created successfully',
      credential: createdRecord,
    },
    { status: 201 }
  );
});
