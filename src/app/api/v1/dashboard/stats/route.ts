import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async () => {
  // C3: Dashboard counts MUST come from actual PostgreSQL queries, NOT hardcoded placeholders.
  const [
    totalUsers,
    totalProviders,
    expiringLicenses,
    expiringDea,
    pendingEnrollments,
    overdueTasks,
  ] = await Promise.all([
    // 1. Total active users in the system
    prisma.user.count({ where: { isActive: true } }),

    // 2. Total active healthcare providers (0 in Phase 1)
    prisma.provider.count({ where: { status: 'active' } }),

    // 3. Expiring state licenses within 90 days
    prisma.stateLicense.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          gte: new Date(),
        },
      },
    }),

    // 4. Expiring DEA registrations within 90 days
    prisma.deaRegistration.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          gte: new Date(),
        },
      },
    }),

    // 5. Pending payer enrollments
    prisma.payerEnrollment.count({
      where: {
        status: { in: ['in_progress', 'submitted', 'pending_payer'] },
      },
    }),

    // 6. Overdue tasks
    prisma.task.count({
      where: {
        status: 'pending',
        dueDate: {
          lt: new Date(),
        },
      },
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalUsers,
      totalProviders,
      expiringCredentials: expiringLicenses + expiringDea,
      pendingEnrollments,
      overdueTasks,
    },
    // Explicitly identify dashboard features deferred to later phases (per C3 / Appendix B)
    deferredMetrics: {
      expirationTimeline: 'Phase 6 (requires provider credentials)',
      enrollmentStatusChart: 'Phase 6 (requires payer enrollments)',
      missingDocumentsSummary: 'Phase 6 (requires documents & payer rule scanner)',
    },
    retrievedAt: new Date().toISOString(),
  });
});
