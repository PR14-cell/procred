import { Queue } from 'bullmq';
import { bullRedisConnection } from './expiration-queue';

export const enrollmentQueue = new Queue('enrollment-scanner', {
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

export async function scheduleEnrollmentScanJob() {
  try {
    return await enrollmentQueue.add(
      'scan-enrollment-followups',
      { timestamp: new Date().toISOString() },
      {
        jobId: `enrollment-scan-${new Date().toISOString().slice(0, 10)}`, // Idempotent per day
      }
    );
  } catch (err) {
    console.warn('[BullMQQueueWarn] Could not schedule enrollment job to Redis:', err);
    return null;
  }
}
