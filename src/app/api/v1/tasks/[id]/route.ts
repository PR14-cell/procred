import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { TaskService } from '@/lib/tasks/task-service';
import { updateTaskSchema } from '@/lib/validation/task';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// GET /api/v1/tasks/[id] - Get task details
export const GET = withErrorHandler(async (req: Request, context?: RouteContext) => {
  await requireAuth(req, 'tasks:read');
  const taskId = context!.params.id;

  const task = await TaskService.getTaskById(taskId);

  return NextResponse.json({ task });
});

// PUT /api/v1/tasks/[id] - Update task details
export const PUT = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'tasks:write');
  const taskId = context!.params.id;
  const body = await req.json();

  const validated = updateTaskSchema.parse(body);

  const updatedTask = await TaskService.updateTask(taskId, validated, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json({
    message: 'Task updated successfully',
    task: updatedTask,
  });
});
