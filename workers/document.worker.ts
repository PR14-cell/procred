import { Worker, Job } from 'bullmq';
import { bullRedisConnection } from '../src/lib/queue/document-queue';
import { scanDocumentExpirationsAndPendingReview } from '../src/lib/documents/document-service';

export function startDocumentWorker() {
  const worker = new Worker(
    'document-scanner',
    async (job: Job) => {
      console.log(`[DocumentWorker] Processing job ${job.id} at ${new Date().toISOString()}`);
      const result = await scanDocumentExpirationsAndPendingReview();
      console.log('[DocumentWorker] Scan completed:', result);
      return result;
    },
    {
      connection: bullRedisConnection,
      concurrency: 1,
    }
  );

  worker.on('completed', (job: Job) => {
    console.log(`[DocumentWorker] Job ${job.id} has completed successfully.`);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[DocumentWorker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startDocumentWorker();
}
