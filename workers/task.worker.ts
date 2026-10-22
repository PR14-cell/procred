import { Worker, Job } from 'bullmq';
import { bullRedisConnection } from '../src/lib/queue/expiration-queue';
import { prisma } from '../src/lib/db/prisma';
import { dispatchNotification } from '../src/lib/notifications/notification-adapter';

export async function scanDueTasksAndNotify() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Find non-completed, non-cancelled tasks assigned to users with dueDate <= today
  const dueTasks = await prisma.task.findMany({
    where: {
      status: { notIn: ['completed', 'cancelled'] },
      dueDate: { lte: today },
      assignedToId: { not: null },
    },
    include: {
      assignedTo: { select: { id: true, email: true, firstName: true } },
    },
  });

  let notificationsSent = 0;
  for (const task of dueTasks) {
    if (task.assignedToId) {
      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
      const title = isOverdue ? 'Overdue Task Alert' : 'Task Due Today';
      await dispatchNotification({
        userId: task.assignedToId,
        type: 'task_due',
        title,
        message: `Task "${task.title}" is ${isOverdue ? 'overdue' : 'due today'} (${task.priority.toUpperCase()} priority).`,
        entityType: 'task',
        entityId: task.id,
      }).catch((e) => console.warn(`[TaskWorker] Failed notifying user ${task.assignedToId}:`, e));
      notificationsSent++;
    }
  }

  return { scanned: dueTasks.length, notificationsSent };
}

export function startTaskWorker() {
  const worker = new Worker(
    'task-operations',
    async (job: Job) => {
      console.log(`[TaskWorker] Processing job ${job.id} at ${new Date().toISOString()}`);
      const result = await scanDueTasksAndNotify();
      console.log(`[TaskWorker] Task scan completed:`, result);
      return result;
    },
    {
      connection: bullRedisConnection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job: Job) => {
    console.log(`[TaskWorker] Job ${job.id} has completed successfully.`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[TaskWorker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startTaskWorker();
}
