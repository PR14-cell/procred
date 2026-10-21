import { Worker, Job } from 'bullmq';
import { bullRedisConnection } from '../src/lib/queue/expiration-queue';
import { scanEnrollmentFollowUpsAndRevalidations } from '../src/lib/enrollments/enrollment-service';

export function startEnrollmentWorker() {
  const worker = new Worker(
    'enrollment-scanner',
    async (job: Job) => {
      console.log(`[EnrollmentWorker] Processing job ${job.id} at ${new Date().toISOString()}`);
      const result = await scanEnrollmentFollowUpsAndRevalidations();
      console.log(`[EnrollmentWorker] Scan completed:`, result);
      return result;
    },
    {
      connection: bullRedisConnection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job: Job) => {
    console.log(`[EnrollmentWorker] Job ${job.id} has completed successfully.`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[EnrollmentWorker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startEnrollmentWorker();
}
