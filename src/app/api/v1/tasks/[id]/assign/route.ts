import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { TaskService } from '@/lib/tasks/task-service';
import { assignTaskSchema } from '@/lib/validation/task';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/tasks/[id]/assign - Assign or reassign task to a user
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'tasks:write');
  const taskId = context!.params.id;
  const body = await req.json();

  const validated = assignTaskSchema.parse(body);

  const updatedTask = await TaskService.assignTask(taskId, validated.assignedToId, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json({
    message: 'Task assigned successfully',
    task: updatedTask,
  });
});
