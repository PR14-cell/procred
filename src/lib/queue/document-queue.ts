import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://:redis_secure_pass_123@localhost:6379';
const parsedUrl = new URL(redisUrl);

export const bullRedisConnection = {
  host: parsedUrl.hostname || 'localhost',
  port: Number(parsedUrl.port) || 6379,
  password: parsedUrl.password || undefined,
  maxRetriesPerRequest: null,
};

export const documentQueue = new Queue('document-scanner', {
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

export async function scheduleDocumentScanJob() {
  try {
    return await documentQueue.add(
      'scan-documents',
      { timestamp: new Date().toISOString() },
      {
        jobId: `document-scan-${new Date().toISOString().slice(0, 10)}`, // Idempotent per day
      }
    );
  } catch (err) {
    console.warn('[DocumentQueueWarn] Could not queue job to Redis:', err);
    return null;
  }
}
