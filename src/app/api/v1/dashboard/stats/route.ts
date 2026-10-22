import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { ReportService, DateRangeFilter } from '@/lib/reports/report-service';

export const dynamic = 'force-dynamic';

// GET /api/v1/dashboard/stats - Executive dashboard aggregated statistics and attention alerts
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'reports:read');

  const { searchParams } = new URL(req.url);
  const filter: DateRangeFilter = {
    timeRange: (searchParams.get('timeRange') as any) || 'all_time',
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
  };

  const [dashboardData, attentionItems] = await Promise.all([
    ReportService.getExecutiveDashboard(filter),
    ReportService.getOperationalAttentionItems(10),
  ]);

  return NextResponse.json({
    stats: {
      ...dashboardData,
      // Backwards-compatible aliases for previously defined widgets
      totalUsers: dashboardData.providers.total, // baseline
      totalProviders: dashboardData.providers.total,
      expiringCredentials: dashboardData.credentials.expiringSoon,
      pendingEnrollments: dashboardData.enrollments.pending,
      overdueTasks: dashboardData.tasks.overdue,
    },
    actionRequired: attentionItems,
    retrievedAt: new Date().toISOString(),
  });
});
