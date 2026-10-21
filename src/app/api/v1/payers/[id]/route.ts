import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { updatePayerSchema } from '@/lib/validation/enrollment';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/payers/[id] - Get Payer Detail
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'payers:read');
  const payerId = context!.params.id;

  const payer = await prisma.payer.findUnique({
    where: { id: payerId },
    include: {
      enrollments: {
        include: {
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
          location: { select: { id: true, name: true, city: true, state: true } },
        },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!payer) {
    throw ApiError.notFound('Payer not found.');
  }

  return NextResponse.json({ payer });
});

// PUT /api/v1/payers/[id] - Update Payer
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'payers:write');
  const payerId = context!.params.id;
  const body = await req.json();

  const data = updatePayerSchema.parse(body);

  const existing = await prisma.payer.findUnique({ where: { id: payerId } });
  if (!existing) {
    throw ApiError.notFound('Payer not found.');
  }

  const updated = await prisma.payer.update({
    where: { id: payerId },
    data: {
      name: data.name ?? existing.name,
      shortName: data.shortName !== undefined ? data.shortName : existing.shortName,
      payerType: data.payerType ?? existing.payerType,
      state: data.state !== undefined ? data.state : existing.state,
      website: data.website !== undefined ? (data.website || null) : existing.website,
      phone: data.phone !== undefined ? data.phone : existing.phone,
      enrollmentPortalUrl: data.enrollmentPortalUrl !== undefined ? (data.enrollmentPortalUrl || null) : existing.enrollmentPortalUrl,
      requiredDocumentTypes: data.requiredDocumentTypes ?? existing.requiredDocumentTypes,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'PAYER_UPDATED',
    entityType: 'payer',
    entityId: payerId,
    changes: body,
  });

  return NextResponse.json({
    message: 'Payer updated successfully',
    payer: updated,
  });
});
