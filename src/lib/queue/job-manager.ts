import { Queue } from 'bullmq';
import { bullRedisConnection } from './expiration-queue';

export const QUEUE_NAMES = [
  'expiration-scanner',
  'enrollment-scanner',
  'task-operations',
  'document-scanner',
  'email-dispatch',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const queueMap = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  if (!queueMap.has(name)) {
    const q = new Queue(name, {
      connection: bullRedisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    queueMap.set(name, q);
  }
  return queueMap.get(name)!;
}

export interface QueueStatusMetrics {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  isPaused: boolean;
}

export async function getAllQueueMetrics(): Promise<QueueStatusMetrics[]> {
  const metrics: QueueStatusMetrics[] = [];

  for (const name of QUEUE_NAMES) {
    try {
      const q = getQueue(name);
      const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        q.getWaitingCount().catch(() => 0),
        q.getActiveCount().catch(() => 0),
        q.getCompletedCount().catch(() => 0),
        q.getFailedCount().catch(() => 0),
        q.getDelayedCount().catch(() => 0),
        q.isPaused().catch(() => false),
      ]);

      metrics.push({
        name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        isPaused,
      });
    } catch (err) {
      metrics.push({
        name,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        isPaused: false,
      });
    }
  }

  return metrics;
}

export async function triggerJob(queueName: QueueName, jobName: string, data: any = {}) {
  const q = getQueue(queueName);
  return await q.add(jobName, { ...data, triggeredAt: new Date().toISOString() });
}

export async function retryFailedJobs(queueName: QueueName) {
  const q = getQueue(queueName);
  const failedJobs = await q.getFailed(0, 50);
  let retriedCount = 0;

  for (const job of failedJobs) {
    try {
      await job.retry();
      retriedCount++;
    } catch (err) {
      console.warn(`[JobManager] Failed to retry job ${job.id}:`, err);
    }
  }

  return { queueName, retriedCount };
}

export async function getFailedJobDetails(queueName: QueueName) {
  const q = getQueue(queueName);
  const failed = await q.getFailed(0, 20);

  return failed.map((job) => ({
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  }));
}
