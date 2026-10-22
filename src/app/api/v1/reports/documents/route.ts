import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { ReportService } from '@/lib/reports/report-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/reports/documents - Document categorization, verification, and expiration analytics
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'reports:read');

  const analytics = await ReportService.getDocumentAnalytics();

  return NextResponse.json(analytics);
});
