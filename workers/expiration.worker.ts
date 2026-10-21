import { Worker, Job } from 'bullmq';
import { bullRedisConnection } from '../src/lib/queue/expiration-queue';
import { scanUpcomingExpirationsAndCreateTasks } from '../src/lib/credentials/credential-service';

export function startExpirationWorker() {
  const worker = new Worker(
    'expiration-scanner',
    async (job: Job) => {
      console.log(`[ExpirationWorker] Processing job ${job.id} at ${new Date().toISOString()}`);
      const result = await scanUpcomingExpirationsAndCreateTasks();
      console.log(`[ExpirationWorker] Scan completed:`, result);
      return result;
    },
    {
      connection: bullRedisConnection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job: Job) => {
    console.log(`[ExpirationWorker] Job ${job.id} has completed successfully.`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[ExpirationWorker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startExpirationWorker();
}
