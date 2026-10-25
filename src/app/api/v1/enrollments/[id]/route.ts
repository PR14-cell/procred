import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { updateEnrollmentSchema } from '@/lib/validation/enrollment';
import { calculateEnrollmentAging, evaluateFollowUpStatus } from '@/lib/enrollments/enrollment-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/enrollments/[id] - Detail view
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'enrollments:read');
  const enrollmentId = context!.params.id;

  const enrollment = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      provider: true,
      payer: true,
      location: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      statusHistory: {
        include: { changedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      },
      followUps: {
        include: { createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { followUpDate: 'desc' },
      },
    },
  });

  if (!enrollment) {
    throw ApiError.notFound('Enrollment not found.');
  }

  // Fetch linked documents and tasks
  const [documents, tasks] = await Promise.all([
    prisma.document.findMany({
      where: { entityType: 'payer_enrollment', entityId: enrollmentId },
      include: { currentVersion: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.task.findMany({
      where: { entityType: 'payer_enrollment', entityId: enrollmentId },
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    }),
  ]);

  const agingDays = calculateEnrollmentAging(enrollment.submittedDate);
  const followUpInfo = evaluateFollowUpStatus(enrollment.followUpDate);

  return NextResponse.json({
    enrollment: {
      ...enrollment,
      agingDays,
      followUpInfo,
      missingItems: enrollment.missingItems || [],
    },
    documents,
    tasks,
  });
});

// PUT /api/v1/enrollments/[id] - Update enrollment
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'enrollments:write');
  const enrollmentId = context!.params.id;
  const body = await req.json();

  const data = updateEnrollmentSchema.parse(body);

  const existing = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing) {
    throw ApiError.notFound('Enrollment not found.');
  }

  const updated = await prisma.payerEnrollment.update({
    where: { id: enrollmentId },
    data: {
      locationId: data.locationId !== undefined ? data.locationId : existing.locationId,
      organizationId: data.organizationId !== undefined ? data.organizationId : existing.organizationId,
      enrollmentType: data.enrollmentType ?? existing.enrollmentType,
      applicationType: data.applicationType ?? existing.applicationType,
      status: data.status ?? existing.status,
      providerPayerId: data.providerPayerId !== undefined ? data.providerPayerId : existing.providerPayerId,
      groupNumber: data.groupNumber !== undefined ? data.groupNumber : existing.groupNumber,
      groupNpi: data.groupNpi !== undefined ? (data.groupNpi || null) : existing.groupNpi,
      submittedDate: data.submittedDate ? new Date(data.submittedDate) : (data.submittedDate === null ? null : existing.submittedDate),
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : (data.effectiveDate === null ? null : existing.effectiveDate),
      terminationDate: data.terminationDate ? new Date(data.terminationDate) : (data.terminationDate === null ? null : existing.terminationDate),
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : (data.followUpDate === null ? null : existing.followUpDate),
      lastFollowUpDate: data.lastFollowUpDate ? new Date(data.lastFollowUpDate) : (data.lastFollowUpDate === null ? null : existing.lastFollowUpDate),
      revalidationDate: data.revalidationDate ? new Date(data.revalidationDate) : (data.revalidationDate === null ? null : existing.revalidationDate),
      revalidationCycleMonths: data.revalidationCycleMonths !== undefined ? data.revalidationCycleMonths : existing.revalidationCycleMonths,
      trackingNumber: data.trackingNumber !== undefined ? data.trackingNumber : existing.trackingNumber,
      assignedToId: data.assignedToId !== undefined ? data.assignedToId : existing.assignedToId,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      missingItems: data.missingItems !== undefined ? (data.missingItems as unknown as any) : existing.missingItems,
    },
    include: {
      provider: true,
      payer: true,
      location: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_UPDATED',
    entityType: 'payer_enrollment',
    entityId: enrollmentId,
    changes: body,
  });

  return NextResponse.json({
    message: 'Enrollment updated successfully',
    enrollment: updated,
  });
});

// DELETE /api/v1/enrollments/[id] - Terminate / Soft-archive enrollment
export const DELETE = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'enrollments:write');
  const enrollmentId = context!.params.id;

  const updated = await prisma.payerEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'terminated',
      terminationDate: new Date(),
    },
  });

  await prisma.enrollmentStatusHistory.create({
    data: {
      enrollmentId,
      previousStatus: updated.status,
      newStatus: 'terminated',
      changedById: session.userId,
      notes: 'Enrollment application terminated or archived.',
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_TERMINATED',
    entityType: 'payer_enrollment',
    entityId: enrollmentId,
  });

  return NextResponse.json({
    message: 'Enrollment terminated successfully',
  });
});
