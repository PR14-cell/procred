import { NextResponse } from 'next/server';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { ReportService } from '@/lib/reports/report-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/reports/workload - Staff operational workload and task distribution
export const GET = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'reports:read');

  if (session.role === 'viewer') {
    throw ApiError.forbidden('Forbidden: Staff workload visibility requires specialist or administrator role.');
  }

  const analytics = await ReportService.getWorkloadAnalytics();

  return NextResponse.json(analytics);
});
