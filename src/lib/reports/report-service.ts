import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export interface DateRangeFilter {
  timeRange?: 'today' | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'this_year' | 'custom' | 'all_time';
  startDate?: string;
  endDate?: string;
}

export interface ActionRequiredItem {
  id: string;
  title: string;
  subtitle: string;
  category: 'credential' | 'enrollment' | 'document' | 'task';
  urgency: 'critical' | 'high' | 'medium';
  actionDate?: string | null;
  drillDownUrl: string;
}

export class ReportService {
  /**
   * Helper to parse date boundaries from timeRange string or custom ISO dates.
   */
  static parseDateRange(filter: DateRangeFilter = {}): { fromDate?: Date; toDate?: Date } {
    const now = new Date();
    const range = filter.timeRange || 'all_time';

    if (range === 'today') {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      const to = new Date(now);
      to.setHours(23, 59, 59, 999);
      return { fromDate: from, toDate: to };
    }

    if (range === 'last_7_days') {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      from.setHours(0, 0, 0, 0);
      return { fromDate: from, toDate: now };
    }

    if (range === 'last_30_days') {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      return { fromDate: from, toDate: now };
    }

    if (range === 'last_90_days') {
      const from = new Date(now);
      from.setDate(from.getDate() - 90);
      from.setHours(0, 0, 0, 0);
      return { fromDate: from, toDate: now };
    }

    if (range === 'this_year') {
      const from = new Date(now.getFullYear(), 0, 1);
      return { fromDate: from, toDate: now };
    }

    if (range === 'custom' && filter.startDate) {
      const from = new Date(filter.startDate);
      const to = filter.endDate ? new Date(filter.endDate) : now;
      if (isNaN(from.getTime())) {
        throw ApiError.badRequest('Invalid startDate format');
      }
      return { fromDate: from, toDate: to };
    }

    return {};
  }

  /**
   * 1. Executive Dashboard Aggregated Overview
   */
  static async getExecutiveDashboard(filter: DateRangeFilter = {}) {
    const { fromDate, toDate } = this.parseDateRange(filter);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Optional creation date filter for general records if date range specified
    const createdFilter = fromDate || toDate ? {
      createdAt: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    } : {};

    const [
      totalProviders,
      activeProviders,
      inactiveProviders,
      stateLicenses,
      deaRegistrations,
      boardCertifications,
      malpracticePolicies,
      caqhProfiles,
      enrollments,
      documents,
      tasks,
    ] = await Promise.all([
      prisma.provider.count({ where: createdFilter }),
      prisma.provider.count({ where: { status: 'active', ...createdFilter } }),
      prisma.provider.count({ where: { status: 'inactive', ...createdFilter } }),

      prisma.stateLicense.findMany({
        select: { id: true, status: true, expirationDate: true, providerId: true },
      }),
      prisma.deaRegistration.findMany({
        select: { id: true, status: true, expirationDate: true, providerId: true },
      }),
      prisma.boardCertification.findMany({
        select: { id: true, status: true, expirationDate: true, providerId: true },
      }),
      prisma.malpracticeInsurance.findMany({
        select: { id: true, status: true, expirationDate: true, providerId: true },
      }),
      prisma.caqhProfile.findMany({
        select: { id: true, attestationStatus: true, nextAttestationDate: true, providerId: true },
      }),

      prisma.payerEnrollment.findMany({
        where: createdFilter,
        select: {
          id: true,
          status: true,
          enrollmentType: true,
          submittedDate: true,
          followUpDate: true,
          revalidationDate: true,
          providerId: true,
        },
      }),

      prisma.document.findMany({
        where: createdFilter,
        select: { id: true, status: true, expirationDate: true, documentType: true, providerId: true },
      }),

      prisma.task.findMany({
        where: createdFilter,
        select: { id: true, status: true, priority: true, dueDate: true, assignedToId: true, taskType: true },
      }),
    ]);

    // Aggregate Credentials
    const allCreds = [
      ...stateLicenses.map((c) => ({ ...c, type: 'state_license' })),
      ...deaRegistrations.map((c) => ({ ...c, type: 'dea_registration' })),
      ...boardCertifications.map((c) => ({ ...c, type: 'board_certification' })),
      ...malpracticePolicies.map((c) => ({ ...c, type: 'malpractice_insurance' })),
      ...caqhProfiles.map((c) => ({
        id: c.id,
        status: c.attestationStatus,
        expirationDate: c.nextAttestationDate,
        providerId: c.providerId,
        type: 'caqh_profile',
      })),
    ];

    let credsActive = 0;
    let credsExpiringSoon = 0;
    let credsExpired = 0;
    let credsPending = 0;
    const credsAttentionProviderIds = new Set<string>();

    for (const cred of allCreds) {
      const expDate = cred.expirationDate ? new Date(cred.expirationDate) : null;
      const isExpired = cred.status === 'expired' || (expDate && expDate < todayStart);
      const isExpiring = !isExpired && expDate && expDate <= in90Days && expDate >= todayStart;

      if (isExpired) {
        credsExpired++;
        if (cred.providerId) credsAttentionProviderIds.add(cred.providerId);
      } else if (isExpiring) {
        credsExpiringSoon++;
      }

      if (cred.status === 'active') {
        credsActive++;
      } else if (cred.status === 'pending_verification' || cred.status === 'pending') {
        credsPending++;
        if (cred.providerId) credsAttentionProviderIds.add(cred.providerId);
      }
    }

    // Aggregate Enrollments
    let enrPending = 0;
    let enrNeedsInfo = 0;
    let enrApproved = 0;
    let enrActive = 0;
    let enrDenied = 0;
    let enrTerminated = 0;
    let enrRevalRequired = 0;
    let enrOverdueFollowups = 0;
    let enrIndividual = 0;
    let enrGroup = 0;

    const enrAging = {
      under30: 0,
      days31to60: 0,
      days61to90: 0,
      days91to120: 0,
      over120: 0,
    };

    for (const enr of enrollments) {
      if (enr.enrollmentType === 'group') enrGroup++;
      else enrIndividual++;

      if (['submitted', 'pending', 'preparing'].includes(enr.status)) enrPending++;
      else if (enr.status === 'needs_info') enrNeedsInfo++;
      else if (enr.status === 'approved') enrApproved++;
      else if (enr.status === 'active') enrActive++;
      else if (enr.status === 'denied') enrDenied++;
      else if (enr.status === 'terminated') enrTerminated++;
      else if (enr.status === 'revalidation_required') enrRevalRequired++;

      if (enr.revalidationDate) {
        const rev = new Date(enr.revalidationDate);
        if (rev <= in90Days && rev >= todayStart) enrRevalRequired++;
      }

      if (enr.followUpDate) {
        const fDate = new Date(enr.followUpDate);
        if (fDate < todayStart && !['approved', 'active', 'terminated'].includes(enr.status)) {
          enrOverdueFollowups++;
        }
      }

      // Aging for pending items
      if (['submitted', 'pending', 'preparing', 'needs_info'].includes(enr.status) && enr.submittedDate) {
        const days = Math.floor((now.getTime() - new Date(enr.submittedDate).getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) enrAging.under30++;
        else if (days <= 60) enrAging.days31to60++;
        else if (days <= 90) enrAging.days61to90++;
        else if (days <= 120) enrAging.days91to120++;
        else enrAging.over120++;
      }
    }

    // Aggregate Documents
    let docPendingReview = 0;
    let docVerified = 0;
    let docRejected = 0;
    let docExpiring = 0;
    let docExpired = 0;

    for (const doc of documents) {
      if (doc.status === 'pending_review' || doc.status === 'uploaded') docPendingReview++;
      else if (doc.status === 'verified') docVerified++;
      else if (doc.status === 'rejected') docRejected++;

      if (doc.expirationDate) {
        const exp = new Date(doc.expirationDate);
        if (exp < todayStart) docExpired++;
        else if (exp <= in30Days && exp >= todayStart) docExpiring++;
      }
    }

    // Aggregate Tasks
    let taskOpen = 0;
    let taskOverdue = 0;
    let taskDueToday = 0;
    let taskUrgent = 0;
    let taskUnassigned = 0;
    let taskCompleted = 0;

    for (const t of tasks) {
      const isClosed = t.status === 'completed' || t.status === 'cancelled';
      if (t.status === 'completed') taskCompleted++;

      if (!isClosed) {
        taskOpen++;
        if (t.priority === 'urgent' || t.priority === 'high') taskUrgent++;
        if (!t.assignedToId) taskUnassigned++;

        if (t.dueDate) {
          const due = new Date(t.dueDate);
          if (due < todayStart) taskOverdue++;
          else if (due >= todayStart && due < tomorrowStart) taskDueToday++;
        }
      }
    }

    // Providers requiring attention
    const providersRequiringAttention = credsAttentionProviderIds.size;

    return {
      providers: {
        total: totalProviders,
        active: activeProviders,
        inactive: inactiveProviders,
        requiringAttention: providersRequiringAttention,
      },
      credentials: {
        total: allCreds.length,
        active: credsActive,
        expiringSoon: credsExpiringSoon,
        expired: credsExpired,
        pendingVerification: credsPending,
        breakdown: {
          licenses: stateLicenses.length,
          dea: deaRegistrations.length,
          boardCertifications: boardCertifications.length,
          malpractice: malpracticePolicies.length,
          caqh: caqhProfiles.length,
        },
      },
      enrollments: {
        total: enrollments.length,
        pending: enrPending,
        needsInfo: enrNeedsInfo,
        approved: enrApproved,
        active: enrActive,
        denied: enrDenied,
        terminated: enrTerminated,
        revalidationRequired: enrRevalRequired,
        overdueFollowups: enrOverdueFollowups,
        individualCount: enrIndividual,
        groupCount: enrGroup,
        agingBuckets: enrAging,
      },
      documents: {
        total: documents.length,
        pendingReview: docPendingReview,
        verified: docVerified,
        rejected: docRejected,
        expiringSoon: docExpiring,
        expired: docExpired,
      },
      tasks: {
        open: taskOpen,
        overdue: taskOverdue,
        dueToday: taskDueToday,
        urgent: taskUrgent,
        unassigned: taskUnassigned,
        completed: taskCompleted,
      },
      filterApplied: {
        timeRange: filter.timeRange || 'all_time',
        fromDate: fromDate?.toISOString() || null,
        toDate: toDate?.toISOString() || null,
      },
      retrievedAt: new Date().toISOString(),
    };
  }

  /**
   * 2. Actionable Operational Attention Items (Critical alerts with direct drill-down links)
   */
  static async getOperationalAttentionItems(limit = 15): Promise<ActionRequiredItem[]> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const items: ActionRequiredItem[] = [];

    // A. Overdue Tasks
    const overdueTasks = await prisma.task.findMany({
      where: {
        dueDate: { lt: todayStart },
        status: { notIn: ['completed', 'cancelled'] },
      },
      take: 5,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      include: { provider: { select: { firstName: true, lastName: true } } },
    });

    for (const t of overdueTasks) {
      items.push({
        id: t.id,
        title: `Overdue Task: ${t.title}`,
        subtitle: t.provider ? `Provider: Dr. ${t.provider.lastName}` : 'System Operational Task',
        category: 'task',
        urgency: t.priority === 'urgent' ? 'critical' : 'high',
        actionDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
        drillDownUrl: `/tasks?dueWindow=overdue`,
      });
    }

    // B. Expired or Expiring State Licenses
    const expiringLicenses = await prisma.stateLicense.findMany({
      where: {
        expirationDate: { lte: in30Days },
        status: { not: 'inactive' },
      },
      take: 5,
      orderBy: { expirationDate: 'asc' },
      include: { provider: { select: { id: true, firstName: true, lastName: true } } },
    });

    for (const lic of expiringLicenses) {
      const isExp = lic.expirationDate && lic.expirationDate < todayStart;
      items.push({
        id: lic.id,
        title: `${isExp ? 'Expired' : 'Expiring'} License: ${lic.state} #${lic.licenseNumber}`,
        subtitle: `Dr. ${lic.provider.firstName} ${lic.provider.lastName}`,
        category: 'credential',
        urgency: isExp ? 'critical' : 'high',
        actionDate: lic.expirationDate ? lic.expirationDate.toISOString().slice(0, 10) : null,
        drillDownUrl: `/credentials?tab=licenses&status=${isExp ? 'expired' : 'expiring_soon'}`,
      });
    }

    // C. Payer Enrollments needing info or with overdue follow-ups
    const alertEnrollments = await prisma.payerEnrollment.findMany({
      where: {
        OR: [
          { status: 'needs_info' },
          { followUpDate: { lt: todayStart }, status: { notIn: ['approved', 'active', 'terminated'] } },
        ],
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
      include: {
        provider: { select: { firstName: true, lastName: true } },
        payer: { select: { name: true } },
      },
    });

    for (const enr of alertEnrollments) {
      const isNeedsInfo = enr.status === 'needs_info';
      items.push({
        id: enr.id,
        title: isNeedsInfo ? `Missing Info: ${enr.payer.name}` : `Follow-up Due: ${enr.payer.name}`,
        subtitle: `Dr. ${enr.provider.firstName} ${enr.provider.lastName}`,
        category: 'enrollment',
        urgency: isNeedsInfo ? 'critical' : 'high',
        actionDate: enr.followUpDate ? enr.followUpDate.toISOString().slice(0, 10) : null,
        drillDownUrl: `/enrollments?status=${isNeedsInfo ? 'needs_info' : 'all'}&overdueOnly=true`,
      });
    }

    // D. Documents Pending Review
    const pendingDocs = await prisma.document.findMany({
      where: { status: { in: ['pending_review', 'uploaded', 'rejected'] } },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { provider: { select: { firstName: true, lastName: true } } },
    });

    for (const doc of pendingDocs) {
      items.push({
        id: doc.id,
        title: `${doc.status === 'rejected' ? 'Rejected' : 'Review Needed'}: ${doc.title}`,
        subtitle: doc.provider ? `Dr. ${doc.provider.firstName} ${doc.provider.lastName}` : 'Unlinked Document',
        category: 'document',
        urgency: doc.status === 'rejected' ? 'critical' : 'medium',
        actionDate: doc.createdAt.toISOString().slice(0, 10),
        drillDownUrl: `/documents?status=${doc.status}`,
      });
    }

    // Sort items: critical first, then high, then medium
    const urgencyWeight = { critical: 3, high: 2, medium: 1 };
    items.sort((a, b) => urgencyWeight[b.urgency] - urgencyWeight[a.urgency]);

    return items.slice(0, limit);
  }

  /**
   * 3. Credential Analytics (Breakdown by status, type, state, and expiration window)
   */
  static async getCredentialAnalytics() {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const [licenses, deas, boards, malpractices, caqhs] = await Promise.all([
      prisma.stateLicense.findMany({
        select: { id: true, state: true, status: true, expirationDate: true },
      }),
      prisma.deaRegistration.findMany({
        select: { id: true, state: true, status: true, expirationDate: true },
      }),
      prisma.boardCertification.findMany({
        select: { id: true, specialty: true, status: true, expirationDate: true },
      }),
      prisma.malpracticeInsurance.findMany({
        select: { id: true, carrierName: true, status: true, expirationDate: true },
      }),
      prisma.caqhProfile.findMany({
        select: { id: true, attestationStatus: true, nextAttestationDate: true },
      }),
    ]);

    const stateBreakdown: Record<string, number> = {};
    const statusCounts: Record<string, number> = {
      active: 0,
      expiring_soon: 0,
      expired: 0,
      pending_verification: 0,
      inactive: 0,
    };

    const windowBuckets = {
      alreadyExpired: 0,
      within14Days: 0,
      within30Days: 0,
      within60Days: 0,
      within90Days: 0,
      beyond90Days: 0,
    };

    const allRecords = [
      ...licenses.map((l) => ({ ...l, type: 'State License' })),
      ...deas.map((d) => ({ ...d, type: 'DEA Registration' })),
      ...boards.map((b) => ({ ...b, type: 'Board Certification' })),
      ...malpractices.map((m) => ({ ...m, type: 'Malpractice Insurance' })),
      ...caqhs.map((c) => ({
        id: c.id,
        status: c.attestationStatus,
        expirationDate: c.nextAttestationDate,
        type: 'CAQH Attestation',
      })),
    ];

    for (const rec of allRecords) {
      if ((rec as any).state) {
        const st = (rec as any).state.toUpperCase();
        stateBreakdown[st] = (stateBreakdown[st] || 0) + 1;
      }

      const exp = rec.expirationDate ? new Date(rec.expirationDate) : null;
      if (exp) {
        if (exp < today) {
          windowBuckets.alreadyExpired++;
          statusCounts.expired++;
        } else if (exp <= in14Days) {
          windowBuckets.within14Days++;
          statusCounts.expiring_soon++;
        } else if (exp <= in30Days) {
          windowBuckets.within30Days++;
          statusCounts.expiring_soon++;
        } else if (exp <= in60Days) {
          windowBuckets.within60Days++;
          statusCounts.expiring_soon++;
        } else if (exp <= in90Days) {
          windowBuckets.within90Days++;
          statusCounts.expiring_soon++;
        } else {
          windowBuckets.beyond90Days++;
        }
      }

      if (rec.status === 'active' && (!exp || exp >= in90Days)) {
        statusCounts.active++;
      } else if (rec.status === 'pending_verification' || rec.status === 'pending') {
        statusCounts.pending_verification++;
      } else if (rec.status === 'inactive') {
        statusCounts.inactive++;
      }
    }

    return {
      total: allRecords.length,
      statusCounts,
      typeBreakdown: {
        stateLicenses: licenses.length,
        deaRegistrations: deas.length,
        boardCertifications: boards.length,
        malpracticeInsurance: malpractices.length,
        caqhProfiles: caqhs.length,
      },
      expirationWindows: windowBuckets,
      topStates: Object.entries(stateBreakdown)
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  /**
   * 4. Payer Enrollment Analytics (Status distribution, top payers, aging buckets)
   */
  static async getEnrollmentAnalytics() {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const enrollments = await prisma.payerEnrollment.findMany({
      include: { payer: { select: { id: true, name: true, payerType: true } } },
    });

    const statusCounts: Record<string, number> = {
      submitted: 0,
      pending: 0,
      preparing: 0,
      needs_info: 0,
      approved: 0,
      active: 0,
      denied: 0,
      terminated: 0,
      revalidation_required: 0,
    };

    const payerVolume: Record<string, { name: string; count: number }> = {};
    let totalAgingDays = 0;
    let pendingWithDateCount = 0;

    const agingBuckets = {
      days0to30: 0,
      days31to60: 0,
      days61to90: 0,
      days91to120: 0,
      over120: 0,
    };

    let individualCount = 0;
    let groupCount = 0;

    for (const enr of enrollments) {
      if (enr.enrollmentType === 'group') groupCount++;
      else individualCount++;

      if (enr.status in statusCounts) {
        statusCounts[enr.status]++;
      }

      if (enr.payer) {
        if (!payerVolume[enr.payer.id]) {
          payerVolume[enr.payer.id] = { name: enr.payer.name, count: 0 };
        }
        payerVolume[enr.payer.id].count++;
      }

      if (['submitted', 'pending', 'preparing', 'needs_info'].includes(enr.status) && enr.submittedDate) {
        const days = Math.floor((now.getTime() - new Date(enr.submittedDate).getTime()) / (1000 * 60 * 60 * 24));
        totalAgingDays += days;
        pendingWithDateCount++;

        if (days <= 30) agingBuckets.days0to30++;
        else if (days <= 60) agingBuckets.days31to60++;
        else if (days <= 90) agingBuckets.days61to90++;
        else if (days <= 120) agingBuckets.days91to120++;
        else agingBuckets.over120++;
      }
    }

    return {
      total: enrollments.length,
      statusCounts,
      individualCount,
      groupCount,
      averageAgingDays: pendingWithDateCount > 0 ? Math.round(totalAgingDays / pendingWithDateCount) : 0,
      agingBuckets,
      topPayers: Object.values(payerVolume)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  /**
   * 5. Document Analytics (Type breakdown, verification metrics, recent files)
   */
  static async getDocumentAnalytics() {
    const [docs, recentUploads] = await Promise.all([
      prisma.document.findMany({
        select: { id: true, documentType: true, status: true, expirationDate: true, createdAt: true },
      }),
      prisma.document.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          provider: { select: { firstName: true, lastName: true } },
          verifiedBy: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {
      uploaded: 0,
      pending_review: 0,
      verified: 0,
      rejected: 0,
    };

    const typeCounts: Record<string, number> = {};
    const now = new Date();

    let expiringIn30Days = 0;
    let expired = 0;

    for (const d of docs) {
      if (d.status in statusCounts) {
        statusCounts[d.status]++;
      }
      typeCounts[d.documentType] = (typeCounts[d.documentType] || 0) + 1;

      if (d.expirationDate) {
        const exp = new Date(d.expirationDate);
        if (exp < now) expired++;
        else if (exp.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000) {
          expiringIn30Days++;
        }
      }
    }

    return {
      total: docs.length,
      statusCounts,
      typeBreakdown: typeCounts,
      expirationAlerts: {
        expiringIn30Days,
        expired,
      },
      recentUploads: recentUploads.map((d) => ({
        id: d.id,
        title: d.title,
        documentType: d.documentType,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        providerName: d.provider ? `Dr. ${d.provider.firstName} ${d.provider.lastName}` : 'Unlinked',
      })),
    };
  }

  /**
   * 6. Staff Workload & Task Analytics
   */
  static async getWorkloadAnalytics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [users, tasks] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      }),
      prisma.task.findMany({
        select: {
          id: true,
          status: true,
          priority: true,
          taskType: true,
          dueDate: true,
          assignedToId: true,
          completedAt: true,
        },
      }),
    ]);

    // Staff workload mapping
    const staffWorkloadMap: Record<
      string,
      {
        id: string;
        name: string;
        role: string;
        openTasks: number;
        overdueTasks: number;
        urgentTasks: number;
        completedTasks: number;
      }
    > = {};

    for (const u of users) {
      staffWorkloadMap[u.id] = {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        role: u.role,
        openTasks: 0,
        overdueTasks: 0,
        urgentTasks: 0,
        completedTasks: 0,
      };
    }

    let unassignedOpenCount = 0;
    const taskTypeCounts: Record<string, number> = {};
    const taskStatusCounts: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const t of tasks) {
      if (t.status in taskStatusCounts) {
        taskStatusCounts[t.status]++;
      }
      taskTypeCounts[t.taskType] = (taskTypeCounts[t.taskType] || 0) + 1;

      const isClosed = t.status === 'completed' || t.status === 'cancelled';
      const isOverdue = !isClosed && t.dueDate && new Date(t.dueDate) < today;
      const isUrgent = !isClosed && (t.priority === 'urgent' || t.priority === 'high');

      if (!t.assignedToId && !isClosed) {
        unassignedOpenCount++;
      }

      if (t.assignedToId && staffWorkloadMap[t.assignedToId]) {
        if (!isClosed) staffWorkloadMap[t.assignedToId].openTasks++;
        if (isOverdue) staffWorkloadMap[t.assignedToId].overdueTasks++;
        if (isUrgent) staffWorkloadMap[t.assignedToId].urgentTasks++;
        if (t.status === 'completed') staffWorkloadMap[t.assignedToId].completedTasks++;
      }
    }

    return {
      totalTasks: tasks.length,
      taskStatusCounts,
      taskTypeCounts,
      unassignedOpenCount,
      staffWorkload: Object.values(staffWorkloadMap).sort((a, b) => b.openTasks - a.openTasks),
    };
  }

  /**
   * 7. Secure CSV Export
   * Escapes fields to prevent CSV formula injection (=, +, -, @) and formats proper rows.
   */
  static async exportReportCsv(
    reportType: 'credentials' | 'enrollments' | 'tasks' | 'documents' | 'audit',
    actor: { id: string; email: string }
  ): Promise<string> {
    const sanitizeCsvCell = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""');
      // Prevent spreadsheet formula injection
      if (/^[=\+\-\@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str}"`;
    };

    let csv = '';

    if (reportType === 'credentials') {
      const [licenses, deas, boards] = await Promise.all([
        prisma.stateLicense.findMany({
          take: 2000,
          include: { provider: { select: { firstName: true, lastName: true, npiNumber: true } } },
        }),
        prisma.deaRegistration.findMany({
          take: 2000,
          include: { provider: { select: { firstName: true, lastName: true, npiNumber: true } } },
        }),
        prisma.boardCertification.findMany({
          take: 2000,
          include: { provider: { select: { firstName: true, lastName: true, npiNumber: true } } },
        }),
      ]);

      const headers = ['Type', 'Provider Name', 'NPI', 'Identifier', 'State/Specialty', 'Status', 'Expiration Date'];
      const rows = [
        ...licenses.map((l) => [
          'State License',
          `Dr. ${l.provider.firstName} ${l.provider.lastName}`,
          l.provider.npiNumber || 'N/A',
          l.licenseNumber,
          l.state,
          l.status,
          l.expirationDate ? l.expirationDate.toISOString().slice(0, 10) : 'None',
        ]),
        ...deas.map((d) => [
          'DEA Registration',
          `Dr. ${d.provider.firstName} ${d.provider.lastName}`,
          d.provider.npiNumber || 'N/A',
          d.deaNumber,
          d.state || 'N/A',
          d.status,
          d.expirationDate ? d.expirationDate.toISOString().slice(0, 10) : 'None',
        ]),
        ...boards.map((b) => [
          'Board Certification',
          `Dr. ${b.provider.firstName} ${b.provider.lastName}`,
          b.provider.npiNumber || 'N/A',
          b.specialty,
          b.boardName,
          b.status,
          b.expirationDate ? b.expirationDate.toISOString().slice(0, 10) : 'None',
        ]),
      ];

      csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.map(sanitizeCsvCell).join(','))].join('\n');
    } else if (reportType === 'enrollments') {
      const enrollments = await prisma.payerEnrollment.findMany({
        take: 3000,
        include: {
          provider: { select: { firstName: true, lastName: true, npiNumber: true } },
          payer: { select: { name: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });

      const headers = ['Provider Name', 'NPI', 'Payer', 'Type', 'Status', 'Submitted Date', 'Follow-up Date', 'Assigned Staff'];
      const rows = enrollments.map((e) => [
        `Dr. ${e.provider.firstName} ${e.provider.lastName}`,
        e.provider.npiNumber || 'N/A',
        e.payer.name,
        e.enrollmentType,
        e.status,
        e.submittedDate ? e.submittedDate.toISOString().slice(0, 10) : 'None',
        e.followUpDate ? e.followUpDate.toISOString().slice(0, 10) : 'None',
        e.assignedTo ? `${e.assignedTo.firstName} ${e.assignedTo.lastName}` : 'Unassigned',
      ]);

      csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.map(sanitizeCsvCell).join(','))].join('\n');
    } else if (reportType === 'tasks') {
      const tasks = await prisma.task.findMany({
        take: 3000,
        include: {
          provider: { select: { firstName: true, lastName: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });

      const headers = ['Task Title', 'Type', 'Priority', 'Status', 'Due Date', 'Assigned To', 'Provider'];
      const rows = tasks.map((t) => [
        t.title,
        t.taskType,
        t.priority,
        t.status,
        t.dueDate ? t.dueDate.toISOString().slice(0, 10) : 'None',
        t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : 'Unassigned',
        t.provider ? `Dr. ${t.provider.firstName} ${t.provider.lastName}` : 'N/A',
      ]);

      csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.map(sanitizeCsvCell).join(','))].join('\n');
    } else if (reportType === 'documents') {
      const docs = await prisma.document.findMany({
        take: 3000,
        include: {
          provider: { select: { firstName: true, lastName: true } },
        },
      });

      const headers = ['Document Title', 'Category', 'Status', 'Expiration Date', 'Provider', 'Uploaded At'];
      const rows = docs.map((d) => [
        d.title,
        d.documentType,
        d.status,
        d.expirationDate ? d.expirationDate.toISOString().slice(0, 10) : 'None',
        d.provider ? `Dr. ${d.provider.firstName} ${d.provider.lastName}` : 'N/A',
        d.createdAt.toISOString().slice(0, 10),
      ]);

      csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.map(sanitizeCsvCell).join(','))].join('\n');
    } else if (reportType === 'audit') {
      const logs = await prisma.auditLog.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });

      const headers = ['Timestamp', 'Actor Email', 'Action', 'Entity Type', 'Entity ID'];
      const rows = logs.map((l) => [
        l.createdAt.toISOString(),
        l.userEmail || 'System',
        l.action,
        l.entityType,
        l.entityId || 'N/A',
      ]);

      csv = [headers.map(sanitizeCsvCell).join(','), ...rows.map((r) => r.map(sanitizeCsvCell).join(','))].join('\n');
    } else {
      throw ApiError.badRequest('Invalid reportType specified');
    }

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'REPORT_EXPORTED',
      entityType: 'report',
      changes: { reportType },
    });

    return csv;
  }
}
