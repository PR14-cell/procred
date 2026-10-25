import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler } from '@/lib/errors/api-error';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { retryFailedJobs, QUEUE_NAMES, QueueName } from '@/lib/queue/job-manager';

export const dynamic = 'force-dynamic';

const retrySchema = z.object({
  queueName: z.enum(QUEUE_NAMES),
});

export const POST = withErrorHandler(async (request: Request) => {
  const session = await requireAuth(request, 'jobs:manage');
  const body = await request.json();
  const { queueName } = retrySchema.parse(body);

  const result = await retryFailedJobs(queueName as QueueName);

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'FAILED_JOBS_RETRIED',
    entityType: 'background_job',
    metadata: { queueName, retriedCount: result.retriedCount },
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
});
