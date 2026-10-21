import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { transitionStatusSchema } from '@/lib/validation/enrollment';
import { transitionEnrollmentStatus } from '@/lib/enrollments/enrollment-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/enrollments/[id]/status - Controlled status transition
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'enrollments:write');
  const enrollmentId = context!.params.id;
  const body = await req.json();

  const data = transitionStatusSchema.parse(body);

  const updated = await transitionEnrollmentStatus({
    enrollmentId,
    newStatus: data.status,
    changedById: session.userId,
    userEmail: session.email,
    notes: data.notes,
  });

  return NextResponse.json({
    message: `Enrollment status updated to ${data.status}`,
    enrollment: updated,
  });
});
