import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { scanEnrollmentFollowUpsAndRevalidations } from '@/lib/enrollments/enrollment-service';

export const dynamic = 'force-dynamic';

// POST /api/v1/enrollments/scan-followups - Trigger follow-up & revalidation scans
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'enrollments:write');

  const result = await scanEnrollmentFollowUpsAndRevalidations();

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'ENROLLMENT_SCAN_EXECUTED',
    entityType: 'payer_enrollment',
    changes: result,
  });

  return NextResponse.json({
    message: 'Enrollment follow-up and revalidation scan completed',
    ...result,
  });
});
