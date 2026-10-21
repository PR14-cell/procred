import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withErrorHandler, ApiError } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { createCredentialTaskSchema } from '@/lib/validation/credential';

export const dynamic = 'force-dynamic';

// GET /api/v1/tasks - List tasks
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'tasks:read');

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') || undefined;
  const entityId = searchParams.get('entityId') || undefined;
  const status = searchParams.get('status') || undefined;
  const assignedToId = searchParams.get('assignedToId') || undefined;

  const tasks = await prisma.task.findMany({
    where: {
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      status: status || undefined,
      assignedToId: assignedToId || undefined,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });

  return NextResponse.json({ tasks });
});

// POST /api/v1/tasks - Create a task
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'tasks:write');
  const body = await req.json();

  const validated = createCredentialTaskSchema.parse(body);

  const task = await prisma.task.create({
    data: {
      title: validated.title,
      description: validated.description,
      entityType: validated.entityType,
      entityId: validated.entityId,
      priority: validated.priority,
      status: 'pending',
      dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
      assignedToId: validated.assignedToId || session.userId,
      createdById: session.userId,
    },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    userEmail: session.email,
    action: 'TASK_CREATED',
    entityType: 'task',
    entityId: task.id,
    changes: {
      title: task.title,
      entityType: task.entityType,
      entityId: task.entityId,
      priority: task.priority,
    },
  });

  return NextResponse.json(
    {
      message: 'Task created successfully',
      task,
    },
    { status: 201 }
  );
});
