import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { ReportService } from '@/lib/reports/report-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/reports/export - Secure CSV export for credentials, enrollments, tasks, documents, or audit
export const GET = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'reports:export');

  const { searchParams } = new URL(req.url);
  const reportType = (searchParams.get('type') || 'credentials') as any;

  const csv = await ReportService.exportReportCsv(reportType, {
    id: session.userId,
    email: session.email,
  });

  const filename = `${reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
});
