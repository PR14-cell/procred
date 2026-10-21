import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import {
  updateStateLicenseSchema,
  updateDeaSchema,
  updateBoardCertSchema,
  updateMalpracticeSchema,
  updateCaqhSchema,
} from '@/lib/validation/credential';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    type: string;
    id: string;
  };
}

// GET /api/v1/credentials/[type]/[id]
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'credentials:read');

  const { type, id } = context!.params;
  let credential: unknown = null;
  let providerId: string | null = null;

  switch (type) {
    case 'state_license': {
      const lic = await prisma.stateLicense.findUnique({
        where: { id },
        include: {
          provider: true,
          verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (lic) {
        credential = lic;
        providerId = lic.providerId;
      }
      break;
    }
    case 'dea_registration': {
      const dea = await prisma.deaRegistration.findUnique({
        where: { id },
        include: {
          provider: true,
          verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (dea) {
        credential = dea;
        providerId = dea.providerId;
      }
      break;
    }
    case 'board_certification': {
      const board = await prisma.boardCertification.findUnique({
        where: { id },
        include: {
          provider: true,
          verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (board) {
        credential = board;
        providerId = board.providerId;
      }
      break;
    }
    case 'malpractice_insurance': {
      const mal = await prisma.malpracticeInsurance.findUnique({
        where: { id },
        include: {
          provider: true,
          verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (mal) {
        credential = mal;
        providerId = mal.providerId;
      }
      break;
    }
    case 'caqh_profile': {
      const caqh = await prisma.caqhProfile.findUnique({
        where: { id },
        include: {
          provider: true,
        },
      });
      if (caqh) {
        credential = caqh;
        providerId = caqh.providerId;
      }
      break;
    }
    default:
      throw ApiError.badRequest(`Unsupported credential type: ${type}`);
  }

  if (!credential) {
    throw ApiError.notFound('Credential record not found.');
  }

  // Fetch verification history, tasks, and documents for this credential
  const [verifications, tasks, documents] = await Promise.all([
    prisma.verificationHistory.findMany({
      where: { entityType: type, entityId: id },
      include: { verifiedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { verifiedDate: 'desc' },
    }),
    prisma.task.findMany({
      where: { entityType: type, entityId: id },
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.document.findMany({
      where: { entityType: type, entityId: id },
      include: { currentVersion: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    credential,
    providerId,
    verifications,
    tasks,
    documents,
  });
});

// PUT /api/v1/credentials/[type]/[id] - Update credential
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'credentials:write');
  const { type, id } = context!.params;
  const body = await req.json();

  let updatedRecord: unknown = null;

  switch (type) {
    case 'state_license': {
      const data = updateStateLicenseSchema.parse(body);
      updatedRecord = await prisma.stateLicense.update({
        where: { id },
        data: {
          state: data.state,
          licenseNumber: data.licenseNumber,
          licenseType: data.licenseType,
          status: data.status,
          issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
          expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
        },
      });
      break;
    }
    case 'dea_registration': {
      const data = updateDeaSchema.parse(body);
      updatedRecord = await prisma.deaRegistration.update({
        where: { id },
        data: {
          deaNumber: data.deaNumber,
          schedule: data.schedule,
          state: data.state,
          status: data.status,
          issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
          expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
        },
      });
      break;
    }
    case 'board_certification': {
      const data = updateBoardCertSchema.parse(body);
      updatedRecord = await prisma.boardCertification.update({
        where: { id },
        data: {
          boardName: data.boardName,
          specialty: data.specialty,
          certificationNumber: data.certificationNumber,
          status: data.status,
          initialCertDate: data.initialCertDate ? new Date(data.initialCertDate) : undefined,
          expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
        },
      });
      break;
    }
    case 'malpractice_insurance': {
      const data = updateMalpracticeSchema.parse(body);
      updatedRecord = await prisma.malpracticeInsurance.update({
        where: { id },
        data: {
          carrierName: data.carrierName,
          policyNumber: data.policyNumber,
          coverageType: data.coverageType,
          perClaimAmount: data.perClaimAmount ? data.perClaimAmount : undefined,
          aggregateAmount: data.aggregateAmount ? data.aggregateAmount : undefined,
          effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : undefined,
          expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
          retroactiveDate: data.retroactiveDate ? new Date(data.retroactiveDate) : undefined,
          status: data.status,
        },
      });
      break;
    }
    case 'caqh_profile': {
      const data = updateCaqhSchema.parse(body);
      updatedRecord = await prisma.caqhProfile.update({
        where: { id },
        data: {
          caqhId: data.caqhId,
          username: data.username,
          lastAttestationDate: data.lastAttestationDate ? new Date(data.lastAttestationDate) : undefined,
          nextAttestationDate: data.nextAttestationDate ? new Date(data.nextAttestationDate) : undefined,
          attestationStatus: data.attestationStatus,
          reauthorizationDate: data.reauthorizationDate ? new Date(data.reauthorizationDate) : undefined,
        },
      });
      break;
    }
    default:
      throw ApiError.badRequest(`Unsupported credential type: ${type}`);
  }

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'CREDENTIAL_UPDATED',
    entityType: type,
    entityId: id,
    changes: body,
  });

  return NextResponse.json({
    message: 'Credential updated successfully',
    credential: updatedRecord,
  });
});

// DELETE /api/v1/credentials/[type]/[id] - Deactivate / Archive
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'credentials:write');
  const { type, id } = context!.params;

  switch (type) {
    case 'state_license':
      await prisma.stateLicense.update({ where: { id }, data: { status: 'inactive' } });
      break;
    case 'dea_registration':
      await prisma.deaRegistration.update({ where: { id }, data: { status: 'inactive' } });
      break;
    case 'board_certification':
      await prisma.boardCertification.update({ where: { id }, data: { status: 'inactive' } });
      break;
    case 'malpractice_insurance':
      await prisma.malpracticeInsurance.update({ where: { id }, data: { status: 'inactive' } });
      break;
    case 'caqh_profile':
      await prisma.caqhProfile.update({ where: { id }, data: { attestationStatus: 'expired' } });
      break;
    default:
      throw ApiError.badRequest(`Unsupported credential type: ${type}`);
  }

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'CREDENTIAL_DEACTIVATED',
    entityType: type,
    entityId: id,
  });

  return NextResponse.json({
    message: 'Credential deactivated successfully',
  });
});
