import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { createEnrollmentSchema } from '@/lib/validation/enrollment';
import { getEnrollments, EnrollmentFilterOptions } from '@/lib/enrollments/enrollment-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/enrollments - Global Enrollment Work Queue
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'enrollments:read');

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const providerId = searchParams.get('providerId') || undefined;
  const payerId = searchParams.get('payerId') || undefined;
  const status = searchParams.get('status') || undefined;
  const enrollmentType = (searchParams.get('enrollmentType') as EnrollmentFilterOptions['enrollmentType']) || 'all';
  const assignedToId = searchParams.get('assignedToId') || undefined;
  const agingDaysMin = searchParams.get('agingDaysMin') ? parseInt(searchParams.get('agingDaysMin')!, 10) : undefined;
  const isOverdueFollowUp = searchParams.get('isOverdueFollowUp') === 'true';
  const isRevalidationRequired = searchParams.get('isRevalidationRequired') === 'true';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const sortBy = (searchParams.get('sortBy') as EnrollmentFilterOptions['sortBy']) || 'updatedAt';
  const sortOrder = (searchParams.get('sortOrder') as EnrollmentFilterOptions['sortOrder']) || 'desc';

  const result = await getEnrollments({
    search,
    providerId,
    payerId,
    status,
    enrollmentType,
    assignedToId,
    agingDaysMin,
    isOverdueFollowUp,
    isRevalidationRequired,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  return NextResponse.json(result);
});

// POST /api/v1/enrollments - Create new enrollment (Individual or Group)
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'enrollments:write');
  const body = await req.json();

  const data = createEnrollmentSchema.parse(body);

  // Verify provider exists
  const provider = await prisma.provider.findUnique({
    where: { id: data.providerId },
  });
  if (!provider) {
    throw ApiError.notFound('Provider not found.');
  }

  // Verify payer exists
  const payer = await prisma.payer.findUnique({
    where: { id: data.payerId },
  });
  if (!payer) {
    throw ApiError.notFound('Payer not found.');
  }

  // Verify location if provided
  if (data.locationId) {
    const loc = await prisma.location.findUnique({
      where: { id: data.locationId },
    });
    if (!loc) {
      throw ApiError.notFound('Location not found.');
    }
  }

  // Create enrollment in transaction with initial status history
  const enrollment = await prisma.$transaction(async (tx) => {
    const enr = await tx.payerEnrollment.create({
      data: {
        providerId: data.providerId,
        payerId: data.payerId,
        locationId: data.locationId || null,
        enrollmentType: data.enrollmentType,
        applicationType: data.applicationType,
        status: data.status,
        providerPayerId: data.providerPayerId || null,
        groupNumber: data.groupNumber || null,
        groupNpi: data.groupNpi || null,
        submittedDate: data.submittedDate ? new Date(data.submittedDate) : null,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        terminationDate: data.terminationDate ? new Date(data.terminationDate) : null,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        lastFollowUpDate: data.lastFollowUpDate ? new Date(data.lastFollowUpDate) : null,
        revalidationDate: data.revalidationDate ? new Date(data.revalidationDate) : null,
        revalidationCycleMonths: data.revalidationCycleMonths || null,
        trackingNumber: data.trackingNumber || null,
        assignedToId: data.assignedToId || session.userId,
        createdById: session.userId,
        notes: data.notes || null,
        missingItems: (data.missingItems as unknown) ?? [],
      },
      include: {
        provider: true,
        payer: true,
        location: true,
      },
    });

    // Record initial status history
    await tx.enrollmentStatusHistory.create({
      data: {
        enrollmentId: enr.id,
        previousStatus: null,
        newStatus: data.status,
        changedById: session.userId,
        notes: 'Initial enrollment application created',
      },
    });

    return enr;
  });

  // Audit log
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_CREATED',
    entityType: 'payer_enrollment',
    entityId: enrollment.id,
    changes: {
      providerId: data.providerId,
      payerId: data.payerId,
      enrollmentType: data.enrollmentType,
      status: data.status,
      groupNpi: data.groupNpi,
    },
  });

  return NextResponse.json(
    {
      message: 'Payer enrollment created successfully',
      enrollment,
    },
    { status: 201 }
  );
});
