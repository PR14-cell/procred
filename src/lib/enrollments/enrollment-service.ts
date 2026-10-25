import { prisma } from '@/lib/db/prisma';
import { dispatchNotification } from '@/lib/notifications/notification-adapter';
import { logAuditEvent } from '@/lib/audit/audit-logger';

export interface EnrollmentFilterOptions {
  search?: string;
  providerId?: string;
  payerId?: string;
  organizationId?: string;
  status?: string;
  enrollmentType?: 'individual' | 'group' | 'all';
  assignedToId?: string;
  agingDaysMin?: number;
  isOverdueFollowUp?: boolean;
  isRevalidationRequired?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'submittedDate' | 'followUpDate' | 'revalidationDate' | 'updatedAt' | 'createdAt' | 'aging';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Timezone-safe calculation of aging days for an enrollment.
 * Computes calendar days elapsed since submittedDate.
 */
export function calculateEnrollmentAging(submittedDate: Date | string | null | undefined): number | null {
  if (!submittedDate) return null;
  const sub = new Date(submittedDate);
  const now = new Date();

  const subUtc = Date.UTC(sub.getUTCFullYear(), sub.getUTCMonth(), sub.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const diffMs = nowUtc - subUtc;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : 0;
}

/**
 * Checks if follow-up date is past due or upcoming (within next 7 days).
 */
export function evaluateFollowUpStatus(followUpDate: Date | string | null | undefined): {
  isOverdue: boolean;
  isUpcoming: boolean;
  daysDiff: number | null;
} {
  if (!followUpDate) {
    return { isOverdue: false, isUpcoming: false, daysDiff: null };
  }
  const fDate = new Date(followUpDate);
  const now = new Date();

  const fUtc = Date.UTC(fDate.getUTCFullYear(), fDate.getUTCMonth(), fDate.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const daysDiff = Math.ceil((fUtc - nowUtc) / (1000 * 60 * 60 * 24));

  return {
    isOverdue: daysDiff < 0,
    isUpcoming: daysDiff >= 0 && daysDiff <= 7,
    daysDiff,
  };
}

/**
 * Retrieve filterable enrollments with aging calculations and summary counts.
 */
export async function getEnrollments(options: EnrollmentFilterOptions = {}) {
  const {
    search,
    providerId,
    payerId,
    organizationId,
    status,
    enrollmentType = 'all',
    assignedToId,
    agingDaysMin,
    isOverdueFollowUp,
    isRevalidationRequired,
    page = 1,
    limit = 20,
    sortBy = 'updatedAt',
    sortOrder = 'desc',
  } = options;

  // Build WHERE conditions
  const where: Record<string, unknown> = {};

  if (providerId) where.providerId = providerId;
  if (payerId) where.payerId = payerId;
  if (organizationId) where.organizationId = organizationId;
  if (status && status !== 'all') where.status = status;
  if (enrollmentType && enrollmentType !== 'all') where.enrollmentType = enrollmentType;
  if (assignedToId) where.assignedToId = assignedToId;

  const now = new Date();
  const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (isOverdueFollowUp) {
    where.followUpDate = { lt: todayDateOnly };
    where.status = { notIn: ['approved', 'active', 'terminated'] };
  }

  if (isRevalidationRequired) {
    where.OR = [
      { status: 'revalidation_required' },
      {
        revalidationDate: {
          lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          gte: now,
        },
      },
    ];
  }

  // Fetch all matching enrollments with relations
  const enrollments = await prisma.payerEnrollment.findMany({
    where,
    include: {
      provider: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          npiNumber: true,
          primaryTaxonomy: true,
        },
      },
      payer: {
        select: {
          id: true,
          name: true,
          shortName: true,
          payerType: true,
          state: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          dbaName: true,
          npiNumber: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          changedBy: { select: { firstName: true, lastName: true } },
        },
      },
      followUps: {
        orderBy: { followUpDate: 'desc' },
        take: 5,
      },
    },
    orderBy: sortBy !== 'aging' ? { [sortBy]: sortOrder } : { updatedAt: 'desc' },
  });

  // Augment with aging and follow-up status
  const enriched = enrollments.map((enr) => {
    const agingDays = calculateEnrollmentAging(enr.submittedDate);
    const followUpInfo = evaluateFollowUpStatus(enr.followUpDate);
    const missing = (enr.missingItems as Array<{ isResolved: boolean }>) || [];
    const openMissingCount = missing.filter((m) => !m.isResolved).length;

    return {
      ...enr,
      agingDays,
      followUpInfo,
      openMissingCount,
      missingItems: enr.missingItems || [],
    };
  });

  // Client-side search & aging filter if specified
  let filtered = enriched;
  if (search && search.trim() !== '') {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.provider.firstName.toLowerCase().includes(q) ||
        e.provider.lastName.toLowerCase().includes(q) ||
        (e.provider.npiNumber && e.provider.npiNumber.includes(q)) ||
        e.payer.name.toLowerCase().includes(q) ||
        (e.payer.shortName && e.payer.shortName.toLowerCase().includes(q)) ||
        (e.trackingNumber && e.trackingNumber.toLowerCase().includes(q)) ||
        (e.groupNumber && e.groupNumber.toLowerCase().includes(q)) ||
        (e.groupNpi && e.groupNpi.includes(q))
    );
  }

  if (agingDaysMin !== undefined && agingDaysMin > 0) {
    filtered = filtered.filter((e) => (e.agingDays ?? 0) >= agingDaysMin);
  }

  // Sort by aging if requested
  if (sortBy === 'aging') {
    filtered.sort((a, b) => {
      const aAging = a.agingDays ?? -1;
      const bAging = b.agingDays ?? -1;
      return sortOrder === 'asc' ? aAging - bAging : bAging - aAging;
    });
  }

  // Real database summary counts across all enrollments
  const allEnrollments = await prisma.payerEnrollment.findMany({
    select: {
      status: true,
      followUpDate: true,
      revalidationDate: true,
      submittedDate: true,
    },
  });

  const summaryCounts = {
    totalCount: allEnrollments.length,
    pendingCount: allEnrollments.filter((e) =>
      ['submitted', 'pending', 'preparing'].includes(e.status)
    ).length,
    needsInfoCount: allEnrollments.filter((e) => e.status === 'needs_info').length,
    approvedCount: allEnrollments.filter((e) => e.status === 'approved').length,
    activeCount: allEnrollments.filter((e) => e.status === 'active').length,
    deniedCount: allEnrollments.filter((e) => e.status === 'denied').length,
    terminatedCount: allEnrollments.filter((e) => e.status === 'terminated').length,
    revalidationRequiredCount: allEnrollments.filter(
      (e) =>
        e.status === 'revalidation_required' ||
        (e.revalidationDate &&
          new Date(e.revalidationDate) <= new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) &&
          new Date(e.revalidationDate) >= new Date())
    ).length,
    overdueFollowUpsCount: allEnrollments.filter(
      (e) =>
        e.followUpDate &&
        new Date(e.followUpDate) < todayDateOnly &&
        !['approved', 'active', 'terminated'].includes(e.status)
    ).length,
    upcomingFollowUpsCount: allEnrollments.filter((e) => {
      if (!e.followUpDate) return false;
      const fDate = new Date(e.followUpDate);
      return fDate >= todayDateOnly && fDate <= new Date(todayDateOnly.getTime() + 7 * 24 * 60 * 60 * 1000);
    }).length,
  };

  // Pagination
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const paginatedItems = filtered.slice((currentPage - 1) * limit, currentPage * limit);

  return {
    items: paginatedItems,
    pagination: {
      page: currentPage,
      limit,
      totalItems,
      totalPages,
    },
    summaryCounts,
  };
}

/**
 * Controlled status transition recording previous status, new status, timestamp, and user in history.
 */
export async function transitionEnrollmentStatus(params: {
  enrollmentId: string;
  newStatus: string;
  changedById: string;
  userEmail?: string;
  notes?: string | null;
}) {
  const { enrollmentId, newStatus, changedById, userEmail, notes } = params;

  const existing = await prisma.payerEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { payer: true, provider: true },
  });

  if (!existing) {
    throw new Error('Enrollment not found');
  }

  const previousStatus = existing.status;

  // 1. Update status on enrollment
  const updated = await prisma.payerEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: newStatus,
      updatedAt: new Date(),
    },
  });

  // 2. Append to status history
  await prisma.enrollmentStatusHistory.create({
    data: {
      enrollmentId,
      previousStatus,
      newStatus,
      changedById,
      notes,
    },
  });

  // 3. Log audit event
  await logAuditEvent({
    userId: changedById,
    userEmail,
    action: 'ENROLLMENT_STATUS_TRANSITION',
    entityType: 'payer_enrollment',
    entityId: enrollmentId,
    changes: {
      previousStatus,
      newStatus,
      notes,
      providerId: existing.providerId,
      payerId: existing.payerId,
    },
  });

  // 4. If status changed to needs_info or denied, create notification/task
  if (newStatus === 'needs_info' || newStatus === 'denied') {
    if (existing.assignedToId) {
      await dispatchNotification({
        userId: existing.assignedToId,
        type: 'enrollment_status_change',
        title: `Enrollment ${newStatus === 'denied' ? 'DENIED' : 'Needs Information'}`,
        message: `${existing.payer.name} enrollment for Dr. ${existing.provider.lastName} moved to "${newStatus.replace('_', ' ').toUpperCase()}".`,
        entityType: 'payer_enrollment',
        entityId: enrollmentId,
      });
    }
  }

  return updated;
}

/**
 * Idempotent scanner for overdue follow-ups and upcoming revalidations.
 * Creates tasks without duplication.
 */
export async function scanEnrollmentFollowUpsAndRevalidations() {
  const now = new Date();
  const todayDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  // 1. Overdue follow-ups
  const overdueEnrollments = await prisma.payerEnrollment.findMany({
    where: {
      followUpDate: { lt: todayDateOnly },
      status: { notIn: ['approved', 'active', 'terminated'] },
    },
    include: { provider: true, payer: true },
  });

  // 2. Upcoming revalidations
  const revalidationsDue = await prisma.payerEnrollment.findMany({
    where: {
      OR: [
        { status: 'revalidation_required' },
        {
          revalidationDate: {
            lte: ninetyDaysOut,
            gte: now,
          },
        },
      ],
      status: { notIn: ['terminated'] },
    },
    include: { provider: true, payer: true },
  });

  let followUpTasksCreated = 0;
  let revalTasksCreated = 0;

  // Find fallback assignee
  const defaultAssignee = await prisma.user.findFirst({
    where: {
      role: { in: ['super_admin', 'admin', 'enrollment_specialist', 'credentialing_specialist'] },
      isActive: true,
    },
  });

  // Process follow-ups
  for (const enr of overdueEnrollments) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'payer_enrollment',
        entityId: enr.id,
        title: { startsWith: 'Follow up with' },
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Follow up with ${enr.payer.name} for Dr. ${enr.provider.lastName}`,
          description: `Enrollment follow-up is overdue (scheduled for ${
            enr.followUpDate ? new Date(enr.followUpDate).toLocaleDateString() : 'Unknown'
          }). Current status: ${enr.status}.`,
          entityType: 'payer_enrollment',
          entityId: enr.id,
          priority: 'urgent',
          status: 'pending',
          dueDate: new Date(),
          assignedToId: enr.assignedToId || defaultAssignee?.id || null,
        },
      });
      followUpTasksCreated++;

      if (enr.assignedToId || defaultAssignee) {
        await dispatchNotification({
          userId: enr.assignedToId || defaultAssignee!.id,
          type: 'task_assigned',
          title: `Overdue Payer Follow-Up: ${enr.payer.name}`,
          message: `Action required: Follow up on application for Dr. ${enr.provider.lastName}.`,
          entityType: 'payer_enrollment',
          entityId: enr.id,
        });
      }
    }
  }

  // Process revalidations
  for (const enr of revalidationsDue) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: 'payer_enrollment',
        entityId: enr.id,
        title: { startsWith: 'Revalidation due for' },
        status: { in: ['pending', 'in_progress', 'open'] },
      },
    });

    if (!existingTask) {
      await prisma.task.create({
        data: {
          title: `Revalidation due for ${enr.payer.name} - Dr. ${enr.provider.lastName}`,
          description: `Payer revalidation due on ${
            enr.revalidationDate ? new Date(enr.revalidationDate).toLocaleDateString() : 'Unknown'
          }. Prepare and submit revalidation application.`,
          entityType: 'payer_enrollment',
          entityId: enr.id,
          priority: 'high',
          status: 'pending',
          dueDate: enr.revalidationDate ? new Date(enr.revalidationDate) : new Date(),
          assignedToId: enr.assignedToId || defaultAssignee?.id || null,
        },
      });
      revalTasksCreated++;
    }
  }

  return {
    overdueFollowUpsScanned: overdueEnrollments.length,
    revalidationsScanned: revalidationsDue.length,
    followUpTasksCreated,
    revalTasksCreated,
  };
}
