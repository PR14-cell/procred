import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server-auth';
import { withErrorHandler } from '@/lib/errors/api-error';
import { getAllQueueMetrics, getFailedJobDetails, QUEUE_NAMES } from '@/lib/queue/job-manager';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async (request: Request) => {
  await requireAuth(request, 'jobs:manage');

  const queues = await getAllQueueMetrics();

  // Fetch recent failed jobs across queues
  const failedJobsByQueue: Record<string, any[]> = {};
  for (const q of QUEUE_NAMES) {
    failedJobsByQueue[q] = await getFailedJobDetails(q).catch(() => []);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    queues,
    failedJobs: failedJobsByQueue,
  });
});
