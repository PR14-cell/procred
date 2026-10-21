import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { createFollowUpSchema } from '@/lib/validation/enrollment';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/enrollments/[id]/follow-ups - Record a structured follow-up
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'enrollments:write');
  const enrollmentId = context!.params.id;
  const body = await req.json();

  const data = createFollowUpSchema.parse(body);

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { provider: true, payer: true },
  });

  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found.');
  }

  const followUpDate = new Date(data.followUpDate);
  const nextFollowUp = data.nextFollowUpDate ? new Date(data.nextFollowUpDate) : null;

  // Transaction: insert follow-up log and update enrollment dates
  const followUp = await prisma.$transaction(async (tx) => {
    const f = await tx.enrollmentFollowUp.create({
      data: {
        enrollmentId,
        followUpDate,
        contactMethod: data.contactMethod,
        contactPerson: data.contactPerson || null,
        referenceNumber: data.referenceNumber || null,
        outcome: data.outcome,
        notes: data.notes || null,
        createdById: session.userId,
      },
    });

    await tx.payerEnrollment.update({
      where: { id: enrollmentId },
      data: {
        lastFollowUpDate: followUpDate,
        followUpDate: nextFollowUp,
      },
    });

    return f;
  });

  // Log audit event
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_FOLLOW_UP_LOGGED',
    entityType: 'payer_enrollment',
    entityId: enrollmentId,
    changes: {
      contactMethod: data.contactMethod,
      outcome: data.outcome,
      followUpDate: data.followUpDate,
      nextFollowUpDate: data.nextFollowUpDate,
    },
  });

  return NextResponse.json(
    {
      message: 'Follow-up logged successfully',
      followUp,
    },
    { status: 201 }
  );
});
