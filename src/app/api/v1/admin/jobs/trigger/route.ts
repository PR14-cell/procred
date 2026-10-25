import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import {
  runCredentialExpirationScanner,
  runCaqhAttestationScanner,
  runEnrollmentRevalidationScanner,
  runOverdueTaskScanner,
  runMissingDocumentScanner,
  runDailyDigestGenerator,
} from '@/lib/automation/automation-service';

export const dynamic = 'force-dynamic';

const triggerSchema = z.object({
  jobType: z.enum([
    'credential_expirations',
    'caqh_attestation',
    'enrollment_revalidation',
    'overdue_tasks',
    'missing_documents',
    'daily_digest',
  ]),
});

export const POST = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request, 'jobs:manage');
  const body = await request.json();
  const { jobType } = triggerSchema.parse(body);

  let result: any = null;

  switch (jobType) {
    case 'credential_expirations':
      result = await runCredentialExpirationScanner();
      break;
    case 'caqh_attestation':
      result = await runCaqhAttestationScanner();
      break;
    case 'enrollment_revalidation':
      result = await runEnrollmentRevalidationScanner();
      break;
    case 'overdue_tasks':
      result = await runOverdueTaskScanner();
      break;
    case 'missing_documents':
      result = await runMissingDocumentScanner();
      break;
    case 'daily_digest':
      result = await runDailyDigestGenerator();
      break;
    default:
      throw ApiError.badRequest('Unknown jobType');
  }

  // Record audit log for administrative job execution
  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'JOB_TRIGGERED',
    entityType: 'background_job',
    metadata: { jobType, result },
  });

  return NextResponse.json({
    success: true,
    jobType,
    result,
    executedAt: new Date().toISOString(),
  });
});
