import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async () => {
  const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Phase 3: Dashboard counts come from real PostgreSQL queries across all credential types
  const [
    totalUsers,
    totalProviders,
    expiringLicenses,
    expiringDea,
    expiringBoards,
    expiringMalpractice,
    expiringCaqh,
    pendingEnrollments,
    overdueTasks,
  ] = await Promise.all([
    // 1. Total active users in the system
    prisma.user.count({ where: { isActive: true } }),

    // 2. Total active healthcare providers
    prisma.provider.count({ where: { status: 'active' } }),

    // 3. Expiring state licenses within 90 days
    prisma.stateLicense.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: ninetyDaysFromNow,
          gte: now,
        },
      },
    }),

    // 4. Expiring DEA registrations within 90 days
    prisma.deaRegistration.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: ninetyDaysFromNow,
          gte: now,
        },
      },
    }),

    // 5. Expiring Board Certifications within 90 days
    prisma.boardCertification.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: ninetyDaysFromNow,
          gte: now,
        },
      },
    }),

    // 6. Expiring Malpractice Policies within 90 days
    prisma.malpracticeInsurance.count({
      where: {
        status: 'active',
        expirationDate: {
          lte: ninetyDaysFromNow,
          gte: now,
        },
      },
    }),

    // 7. Expiring CAQH Attestations within 90 days
    prisma.caqhProfile.count({
      where: {
        attestationStatus: { not: 'expired' },
        nextAttestationDate: {
          lte: ninetyDaysFromNow,
          gte: now,
        },
      },
    }),

    // 8. Pending payer enrollments
    prisma.payerEnrollment.count({
      where: {
        status: { in: ['in_progress', 'submitted', 'pending_payer'] },
      },
    }),

    // 9. Overdue tasks
    prisma.task.count({
      where: {
        status: { in: ['pending', 'in_progress', 'open'] },
        dueDate: {
          lt: now,
        },
      },
    }),
  ]);

  const totalExpiringCredentials =
    expiringLicenses + expiringDea + expiringBoards + expiringMalpractice + expiringCaqh;

  return NextResponse.json({
    stats: {
      totalUsers,
      totalProviders,
      expiringCredentials: totalExpiringCredentials,
      breakdown: {
        licenses: expiringLicenses,
        dea: expiringDea,
        boardCertifications: expiringBoards,
        malpractice: expiringMalpractice,
        caqh: expiringCaqh,
      },
      pendingEnrollments,
      overdueTasks,
    },
    // Explicitly identify dashboard features deferred to later phases
    deferredMetrics: {
      expirationTimeline: 'Phase 6 (visual timeline chart)',
      enrollmentStatusChart: 'Phase 6 (requires payer enrollments)',
      missingDocumentsSummary: 'Phase 6 (requires documents & payer rule scanner)',
    },
    retrievedAt: new Date().toISOString(),
  });
});
