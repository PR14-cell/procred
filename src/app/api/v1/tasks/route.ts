import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { TaskService, TaskFilterOptions } from '@/lib/tasks/task-service';
import { createTaskSchema } from '@/lib/validation/task';

export const dynamic = 'force-dynamic';

// GET /api/v1/tasks - List tasks with pagination, filters, and KPI summary
export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req, 'tasks:read');

  const { searchParams } = new URL(req.url);
  const options: TaskFilterOptions = {
    page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
    pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : undefined,
    status: searchParams.get('status') || undefined,
    priority: searchParams.get('priority') || undefined,
    taskType: searchParams.get('taskType') || undefined,
    assignedToId: searchParams.get('assignedToId') || undefined,
    providerId: searchParams.get('providerId') || undefined,
    entityType: searchParams.get('entityType') || undefined,
    entityId: searchParams.get('entityId') || undefined,
    search: searchParams.get('search') || undefined,
    dueWindow: (searchParams.get('dueWindow') as any) || undefined,
    sortBy: (searchParams.get('sortBy') as any) || undefined,
    sortOrder: (searchParams.get('sortOrder') as any) || undefined,
  };

  const result = await TaskService.getTasks(options);

  return NextResponse.json(result);
});

// POST /api/v1/tasks - Create an operational task
export const POST = withErrorHandler(async (req: Request) => {
  const session = await requireAuth(req, 'tasks:write');
  const body = await req.json();

  const validated = createTaskSchema.parse(body);

  const task = await TaskService.createTask(validated, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json(
    {
      message: 'Task created successfully',
      task,
    },
    { status: 201 }
  );
});
