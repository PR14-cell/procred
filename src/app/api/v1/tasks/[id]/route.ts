import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const updateTaskSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
});

// PUT /api/v1/tasks/[id] - Update task status/details
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'tasks:write');
  const taskId = context!.params.id;
  const body = await req.json();

  const validated = updateTaskSchema.parse(body);

  const existingTask = await prisma.task.findUnique({
    where: { id: taskId },
  });
  if (!existingTask) {
    throw ApiError.notFound('Task not found.');
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: validated.status ?? existingTask.status,
      priority: validated.priority ?? existingTask.priority,
      dueDate: validated.dueDate ? new Date(validated.dueDate) : existingTask.dueDate,
      assignedToId: validated.assignedToId !== undefined ? validated.assignedToId : existingTask.assignedToId,
      description: validated.description !== undefined ? validated.description : existingTask.description,
      completedAt: validated.status === 'completed' ? new Date() : null,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'TASK_UPDATED',
    entityType: 'task',
    entityId: taskId,
    changes: validated,
  });

  return NextResponse.json({
    message: 'Task updated successfully',
    task: updatedTask,
  });
});
