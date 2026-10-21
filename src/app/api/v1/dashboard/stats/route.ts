import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler } from '@/lib/errors/api-error';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandler(async () => {
  const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [
    totalUsers,
    totalProviders,
    expiringLicenses,
    expiringDea,
    expiringBoards,
    expiringMalpractice,
    expiringCaqh,
    enrollmentsList,
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

    // 8. Real database query across all enrollments
    prisma.payerEnrollment.findMany({
      select: {
        status: true,
        submittedDate: true,
        followUpDate: true,
        revalidationDate: true,
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

  // Enrollment metrics calculations
  const totalEnrollments = enrollmentsList.length;
  const pendingEnrollments = enrollmentsList.filter((e) =>
    ['submitted', 'pending', 'preparing'].includes(e.status)
  ).length;
  const needsInfoEnrollments = enrollmentsList.filter((e) => e.status === 'needs_info').length;
  const approvedEnrollments = enrollmentsList.filter((e) => e.status === 'approved').length;
  const activeEnrollments = enrollmentsList.filter((e) => e.status === 'active').length;
  const deniedEnrollments = enrollmentsList.filter((e) => e.status === 'denied').length;
  const terminatedEnrollments = enrollmentsList.filter((e) => e.status === 'terminated').length;
  const revalidationRequiredEnrollments = enrollmentsList.filter(
    (e) =>
      e.status === 'revalidation_required' ||
      (e.revalidationDate &&
        new Date(e.revalidationDate) <= ninetyDaysFromNow &&
        new Date(e.revalidationDate) >= now)
  ).length;

  const overdueFollowUps = enrollmentsList.filter(
    (e) =>
      e.followUpDate &&
      new Date(e.followUpDate) < todayDateOnly &&
      !['approved', 'active', 'terminated'].includes(e.status)
  ).length;

  const upcomingFollowUps = enrollmentsList.filter((e) => {
    if (!e.followUpDate) return false;
    const fDate = new Date(e.followUpDate);
    return fDate >= todayDateOnly && fDate <= new Date(todayDateOnly.getTime() + 7 * 24 * 60 * 60 * 1000);
  }).length;

  // Aging pending enrollments (> 30 days pending)
  const agingPendingEnrollments = enrollmentsList.filter((e) => {
    if (!e.submittedDate || !['submitted', 'pending', 'preparing', 'needs_info'].includes(e.status)) return false;
    const subTime = new Date(e.submittedDate).getTime();
    const diffDays = Math.floor((now.getTime() - subTime) / (1000 * 60 * 60 * 24));
    return diffDays > 30;
  }).length;

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
      enrollments: {
        total: totalEnrollments,
        pending: pendingEnrollments,
        needsInfo: needsInfoEnrollments,
        approved: approvedEnrollments,
        active: activeEnrollments,
        denied: deniedEnrollments,
        terminated: terminatedEnrollments,
        revalidationRequired: revalidationRequiredEnrollments,
        overdueFollowUps,
        upcomingFollowUps,
        agingPending: agingPendingEnrollments,
      },
      pendingEnrollments,
      overdueTasks,
    },
    deferredMetrics: {
      expirationTimeline: 'Phase 6 (visual timeline chart)',
      enrollmentStatusChart: 'Phase 6 (visual breakdown chart)',
      missingDocumentsSummary: 'Phase 6 (requires documents & payer rule scanner)',
    },
    retrievedAt: new Date().toISOString(),
  });
});
