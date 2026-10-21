import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { updateMissingItemsSchema } from '@/lib/validation/enrollment';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// PUT /api/v1/enrollments/[id]/missing-items - Update missing info checklist
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'enrollments:write');
  const enrollmentId = context!.params.id;
  const body = await req.json();

  const data = updateMissingItemsSchema.parse(body);

  const existing = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing) {
    throw ApiError.notFound('Enrollment not found.');
  }

  const updated = await prisma.payerEnrollment.update({
    where: { id: enrollmentId },
    data: {
      missingItems: (data.missingItems as unknown) ?? [],
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_MISSING_ITEMS_UPDATED',
    entityType: 'payer_enrollment',
    entityId: enrollmentId,
    changes: {
      itemsCount: data.missingItems.length,
      unresolvedCount: data.missingItems.filter((i) => !i.isResolved).length,
    },
  });

  return NextResponse.json({
    message: 'Missing items checklist updated',
    missingItems: updated.missingItems,
  });
});
