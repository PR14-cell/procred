import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { dispatchNotification } from '@/lib/notifications/notification-adapter';
import { CreateTaskInput, UpdateTaskInput } from '@/lib/validation/task';

export interface TaskFilterOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  priority?: string;
  taskType?: string;
  assignedToId?: string;
  providerId?: string;
  entityType?: string;
  entityId?: string;
  search?: string;
  dueWindow?: 'overdue' | 'due_today' | 'due_this_week' | 'upcoming';
  sortBy?: 'dueDate' | 'priority' | 'createdAt' | 'status' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface TaskActor {
  id: string;
  email: string;
}

export class TaskService {
  /**
   * Retrieves paginated tasks along with real-time KPI metrics.
   */
  static async getTasks(options: TaskFilterOptions = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Build filter where clause
    const where: any = {};

    if (options.status) {
      if (options.status.includes(',')) {
        where.status = { in: options.status.split(',').map((s) => s.trim()) };
      } else {
        where.status = options.status;
      }
    }

    if (options.priority) {
      where.priority = options.priority;
    }

    if (options.taskType) {
      where.taskType = options.taskType;
    }

    if (options.assignedToId) {
      if (options.assignedToId === 'unassigned') {
        where.assignedToId = null;
      } else {
        where.assignedToId = options.assignedToId;
      }
    }

    if (options.providerId) {
      where.providerId = options.providerId;
    }

    if (options.entityType) {
      where.entityType = options.entityType;
    }

    if (options.entityId) {
      where.entityId = options.entityId;
    }

    if (options.dueWindow) {
      if (options.dueWindow === 'overdue') {
        where.dueDate = { lt: today };
        where.status = { notIn: ['completed', 'cancelled'] };
      } else if (options.dueWindow === 'due_today') {
        where.dueDate = { gte: today, lt: tomorrow };
        where.status = { notIn: ['completed', 'cancelled'] };
      } else if (options.dueWindow === 'due_this_week') {
        where.dueDate = { gte: today, lte: weekEnd };
        where.status = { notIn: ['completed', 'cancelled'] };
      } else if (options.dueWindow === 'upcoming') {
        where.dueDate = { gte: today };
        where.status = { notIn: ['completed', 'cancelled'] };
      }
    }

    if (options.search) {
      const q = options.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        {
          provider: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { npiNumber: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const sortBy = options.sortBy || 'dueDate';
    const sortOrder = options.sortOrder || 'asc';
    const orderBy: any = {};
    if (sortBy === 'priority') {
      orderBy.priority = sortOrder;
    } else if (sortBy === 'status') {
      orderBy.status = sortOrder;
    } else if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === 'title') {
      orderBy.title = sortOrder;
    } else {
      orderBy.dueDate = sortOrder;
    }

    const [tasks, total, statusCounts, overdueCount, urgentCount] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [orderBy, { createdAt: 'desc' }],
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
        },
      }),
      prisma.task.count({ where }),
      prisma.task.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.task.count({
        where: {
          dueDate: { lt: today },
          status: { notIn: ['completed', 'cancelled'] },
        },
      }),
      prisma.task.count({
        where: {
          priority: 'urgent',
          status: { notIn: ['completed', 'cancelled'] },
        },
      }),
    ]);

    const kpiSummary = {
      total: 0,
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
      overdue: overdueCount,
      urgent: urgentCount,
    };

    for (const group of statusCounts) {
      kpiSummary.total += group._count.id;
      if (group.status in kpiSummary) {
        (kpiSummary as any)[group.status] = group._count.id;
      }
    }

    return {
      tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
      kpis: kpiSummary,
    };
  }

  /**
   * Get single task by ID.
   */
  static async getTaskById(id: string) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    if (!task) {
      throw ApiError.notFound('Task not found');
    }

    return task;
  }

  /**
   * Helper to resolve providerId from related entities if not explicitly given.
   */
  private static async resolveProviderId(
    providerId?: string | null,
    entityType?: string | null,
    entityId?: string | null
  ): Promise<string | null> {
    if (providerId) return providerId;
    if (!entityType || !entityId) return null;

    if (entityType === 'provider') {
      return entityId;
    }

    if (entityType === 'state_license') {
      const rec = await prisma.stateLicense.findUnique({ where: { id: entityId }, select: { providerId: true } });
      return rec?.providerId || null;
    }
    if (entityType === 'dea_registration') {
      const rec = await prisma.deaRegistration.findUnique({ where: { id: entityId }, select: { providerId: true } });
      return rec?.providerId || null;
    }
    if (entityType === 'board_certification') {
      const rec = await prisma.boardCertification.findUnique({ where: { id: entityId }, select: { providerId: true } });
      return rec?.providerId || null;
    }
    if (entityType === 'malpractice_policy' || entityType === 'malpractice_insurance') {
      const rec = await prisma.malpracticeInsurance.findUnique({ where: { id: entityId }, select: { providerId: true } });
      return rec?.providerId || null;
    }
    if (entityType === 'caqh_profile') {
      const rec = await prisma.caqhProfile.findUnique({ where: { id: entityId }, select: { providerId: true } });
      return rec?.providerId || null;
    }

    if (entityType === 'payer_enrollment' || entityType === 'enrollment') {
      const enr = await prisma.payerEnrollment.findUnique({
        where: { id: entityId },
        select: { providerId: true },
      });
      return enr?.providerId || null;
    }

    if (entityType === 'document') {
      const doc = await prisma.document.findUnique({
        where: { id: entityId },
        select: { providerId: true },
      });
      return doc?.providerId || null;
    }

    return null;
  }

  /**
   * Create a new task.
   */
  static async createTask(data: CreateTaskInput, actor: TaskActor) {
    const resolvedProviderId = await this.resolveProviderId(
      data.providerId,
      data.entityType,
      data.entityId
    );

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description || null,
        taskType: data.taskType || 'general',
        priority: data.priority || 'medium',
        status: data.status || 'pending',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        assignedToId: data.assignedToId || null,
        createdById: actor.id,
        providerId: resolvedProviderId,
        entityType: data.entityType || null,
        entityId: data.entityId || null,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'TASK_CREATED',
      entityType: 'task',
      entityId: task.id,
      changes: {
        title: task.title,
        taskType: task.taskType,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate,
        assignedToId: task.assignedToId,
        providerId: task.providerId,
      },
    });

    if (task.assignedToId && task.assignedToId !== actor.id) {
      await dispatchNotification({
        userId: task.assignedToId,
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You were assigned: "${task.title}"`,
        entityType: 'task',
        entityId: task.id,
      }).catch((err) => console.error('[TaskService] Notification dispatch failed:', err));
    }

    return task;
  }

  /**
   * Update task details or status.
   */
  static async updateTask(id: string, data: UpdateTaskInput, actor: TaskActor) {
    const existing = await this.getTaskById(id);

    if (existing.status === 'cancelled' && data.status === 'completed') {
      throw ApiError.badRequest('Cannot directly complete a cancelled task');
    }

    const isCompleting = data.status === 'completed' && existing.status !== 'completed';
    const isReopening =
      data.status && data.status !== 'completed' && existing.status === 'completed';

    const updateData: any = { ...data };

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    if (isCompleting) {
      updateData.completedAt = new Date();
      updateData.completedById = actor.id;
      if (data.completionNotes !== undefined) {
        updateData.completionNotes = data.completionNotes;
      }
    } else if (isReopening) {
      updateData.completedAt = null;
      updateData.completedById = null;
      updateData.completionNotes = null;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: isCompleting ? 'TASK_COMPLETED' : 'TASK_UPDATED',
      entityType: 'task',
      entityId: id,
      changes: {
        previous: {
          status: existing.status,
          priority: existing.priority,
          assignedToId: existing.assignedToId,
        },
        current: {
          status: updated.status,
          priority: updated.priority,
          assignedToId: updated.assignedToId,
          completionNotes: updated.completionNotes,
        },
      },
    });

    if (
      data.assignedToId &&
      data.assignedToId !== existing.assignedToId &&
      data.assignedToId !== actor.id
    ) {
      await dispatchNotification({
        userId: data.assignedToId,
        type: 'task_assigned',
        title: 'Task Reassigned to You',
        message: `Task reassigned: "${updated.title}"`,
        entityType: 'task',
        entityId: updated.id,
      }).catch((err) => console.error('[TaskService] Notification dispatch failed:', err));
    }

    return updated;
  }

  /**
   * Dedicated Complete Task endpoint logic.
   */
  static async completeTask(id: string, completionNotes: string | null | undefined, actor: TaskActor) {
    const existing = await this.getTaskById(id);

    if (existing.status === 'cancelled') {
      throw ApiError.badRequest('Cannot complete a cancelled task');
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        completedById: actor.id,
        completionNotes: completionNotes || existing.completionNotes,
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'TASK_COMPLETED',
      entityType: 'task',
      entityId: id,
      changes: {
        previousStatus: existing.status,
        status: 'completed',
        completedById: actor.id,
        completionNotes: updated.completionNotes,
      },
    });

    return updated;
  }

  /**
   * Dedicated Assign Task endpoint logic.
   */
  static async assignTask(id: string, assignedToId: string, actor: TaskActor) {
    const existing = await this.getTaskById(id);

    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw ApiError.badRequest(`Cannot reassign a ${existing.status} task`);
    }

    // Verify assigned user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, isActive: true, firstName: true, lastName: true },
    });

    if (!user || !user.isActive) {
      throw ApiError.badRequest('Assigned user is invalid or inactive');
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { assignedToId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'TASK_ASSIGNED',
      entityType: 'task',
      entityId: id,
      changes: {
        previousAssignedToId: existing.assignedToId,
        newAssignedToId: assignedToId,
      },
    });

    if (assignedToId !== actor.id) {
      await dispatchNotification({
        userId: assignedToId,
        type: 'task_assigned',
        title: 'Task Assigned',
        message: `You were assigned: "${updated.title}"`,
        entityType: 'task',
        entityId: updated.id,
      }).catch((err) => console.error('[TaskService] Notification dispatch failed:', err));
    }

    return updated;
  }

  /**
   * Cancel task.
   */
  static async cancelTask(id: string, reason: string | undefined, actor: TaskActor) {
    const existing = await this.getTaskById(id);

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: 'cancelled',
        completionNotes: reason ? `Cancelled: ${reason}` : 'Cancelled',
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        completedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true, npiNumber: true } },
      },
    });

    await logAuditEvent({
      userId: actor.id,
      userEmail: actor.email,
      action: 'TASK_CANCELLED',
      entityType: 'task',
      entityId: id,
      changes: {
        previousStatus: existing.status,
        status: 'cancelled',
        reason,
      },
    });

    return updated;
  }

  /**
   * Creates an automated operational task idempotently.
   * If an active (non-completed, non-cancelled) task already exists for this taskType and entity, it is reused.
   */
  static async createAutomatedTask(params: {
    title: string;
    description?: string;
    taskType: string;
    priority?: string;
    dueDate?: Date | string | null;
    entityType: string;
    entityId: string;
    providerId?: string | null;
    assignedToId?: string | null;
    actor?: { id?: string; email?: string };
  }) {
    const existingTask = await prisma.task.findFirst({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        taskType: params.taskType,
        status: { notIn: ['completed', 'cancelled'] },
      },
    });

    if (existingTask) {
      return { task: existingTask, created: false };
    }

    const resolvedProviderId = await this.resolveProviderId(
      params.providerId,
      params.entityType,
      params.entityId
    );

    const task = await prisma.task.create({
      data: {
        title: params.title,
        description: params.description || null,
        taskType: params.taskType,
        priority: params.priority || 'medium',
        status: 'pending',
        dueDate: params.dueDate ? new Date(params.dueDate) : null,
        assignedToId: params.assignedToId || null,
        createdById: params.actor?.id || null,
        providerId: resolvedProviderId,
        entityType: params.entityType,
        entityId: params.entityId,
      },
    });

    await logAuditEvent({
      userId: params.actor?.id || null,
      userEmail: params.actor?.email || 'system@internal.automated',
      action: 'AUTOMATED_TASK_CREATED',
      entityType: 'task',
      entityId: task.id,
      changes: {
        title: task.title,
        taskType: task.taskType,
        priority: task.priority,
        entityType: task.entityType,
        entityId: task.entityId,
      },
    });

    return { task, created: true };
  }
}
