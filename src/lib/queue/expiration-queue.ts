import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://:redis_secure_pass_123@localhost:6379';
const parsedUrl = new URL(redisUrl);

export const bullRedisConnection = {
  host: parsedUrl.hostname || 'localhost',
  port: Number(parsedUrl.port) || 6379,
  password: parsedUrl.password || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
};

export const expirationQueue = new Queue('expiration-scanner', {
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

export async function scheduleExpirationScanJob() {
  try {
    return await expirationQueue.add(
      'scan-credential-expirations',
      { timestamp: new Date().toISOString() },
      {
        jobId: `expiration-scan-${new Date().toISOString().slice(0, 10)}`, // Idempotent per day
      }
    );
  } catch (err) {
    console.warn('[BullMQQueueWarn] Could not queue job to Redis:', err);
    return null;
  }
}
