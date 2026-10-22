import { Queue } from 'bullmq';
import { bullRedisConnection } from './expiration-queue';

export const taskQueue = new Queue('task-operations', {
  connection: bullRedisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export async function scheduleTaskDueScanJob() {
  try {
    return await taskQueue.add(
      'scan-due-tasks',
      { timestamp: new Date().toISOString() },
      {
        jobId: `task-scan-${new Date().toISOString().slice(0, 10)}`,
      }
    );
  } catch (err) {
    console.warn('[BullMQQueueWarn] Could not queue task job to Redis:', err);
    return null;
  }
}
