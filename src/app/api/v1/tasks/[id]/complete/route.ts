import { NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/errors/api-error';
import { requireAuth } from '@/lib/auth/server-auth';
import { TaskService } from '@/lib/tasks/task-service';
import { completeTaskSchema } from '@/lib/validation/task';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

// POST /api/v1/tasks/[id]/complete - Mark task as completed with completion notes
export const POST = withErrorHandler(async (req: Request, context?: RouteContext) => {
  const session = await requireAuth(req, 'tasks:write');
  const taskId = context!.params.id;

  let completionNotes: string | undefined;
  try {
    const body = await req.json();
    const validated = completeTaskSchema.parse(body);
    completionNotes = validated.completionNotes || undefined;
  } catch {
    // If no body provided, continue without notes
  }

  const updatedTask = await TaskService.completeTask(taskId, completionNotes, {
    id: session.userId,
    email: session.email,
  });

  return NextResponse.json({
    message: 'Task marked as completed',
    task: updatedTask,
  });
});
