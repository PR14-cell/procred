import { Worker, Job } from 'bullmq';
import fs from 'fs';
import { bullRedisConnection } from '../src/lib/queue/expiration-queue';
import {
  runCredentialExpirationScanner,
  runCaqhAttestationScanner,
  runEnrollmentRevalidationScanner,
  runOverdueTaskScanner,
  runMissingDocumentScanner,
  runDailyDigestGenerator,
} from '../src/lib/automation/automation-service';

const HEARTBEAT_FILE = process.platform === 'win32' ? './.worker-heartbeat' : '/tmp/worker-heartbeat';

function updateHeartbeat() {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, Date.now().toString());
  } catch (err) {
    // Ignore heartbeat write errors
  }
}

export function startAllWorkers() {
  console.log('[WorkerRunner] Initializing Phase 8 Background Automation Workers...');

  // 1. Expiration Scanner Worker
  const expirationWorker = new Worker(
    'expiration-scanner',
    async (job: Job) => {
      console.log(`[ExpirationWorker] Executing job: ${job.name} (ID: ${job.id})`);
      if (job.name === 'scan-caqh-attestation') {
        return await runCaqhAttestationScanner();
      }
      return await runCredentialExpirationScanner();
    },
    { connection: bullRedisConnection, concurrency: 2 }
  );

  // 2. Enrollment Scanner Worker
  const enrollmentWorker = new Worker(
    'enrollment-scanner',
    async (job: Job) => {
      console.log(`[EnrollmentWorker] Executing job: ${job.name} (ID: ${job.id})`);
      return await runEnrollmentRevalidationScanner();
    },
    { connection: bullRedisConnection, concurrency: 2 }
  );

  // 3. Task Scanner Worker
  const taskWorker = new Worker(
    'task-operations',
    async (job: Job) => {
      console.log(`[TaskWorker] Executing job: ${job.name} (ID: ${job.id})`);
      return await runOverdueTaskScanner();
    },
    { connection: bullRedisConnection, concurrency: 2 }
  );

  // 4. Document Scanner Worker
  const documentWorker = new Worker(
    'document-scanner',
    async (job: Job) => {
      console.log(`[DocumentWorker] Executing job: ${job.name} (ID: ${job.id})`);
      if (job.name === 'scan-missing-documents') {
        return await runMissingDocumentScanner();
      }
      return await runMissingDocumentScanner();
    },
    { connection: bullRedisConnection, concurrency: 2 }
  );

  // 5. Email Dispatch & Digest Worker
  const emailWorker = new Worker(
    'email-dispatch',
    async (job: Job) => {
      console.log(`[EmailWorker] Executing job: ${job.name} (ID: ${job.id})`);
      if (job.name === 'send-daily-digest') {
        return await runDailyDigestGenerator();
      }
      return { status: 'processed', job: job.name };
    },
    { connection: bullRedisConnection, concurrency: 2 }
  );

  const workers = [expirationWorker, enrollmentWorker, taskWorker, documentWorker, emailWorker];

  for (const w of workers) {
    w.on('completed', (job) => console.log(`[Worker] Job ${job.name} (${job.id}) completed successfully.`));
    w.on('failed', (job, err) => console.error(`[Worker] Job ${job?.name} (${job?.id}) FAILED:`, err.message));
  }

  // Heartbeat loop for container health check
  const heartbeatInterval = setInterval(updateHeartbeat, 5000);
  updateHeartbeat();

  console.log('[WorkerRunner] All 5 BullMQ Workers active and listening.');

  return {
    workers,
    stop: async () => {
      clearInterval(heartbeatInterval);
      for (const w of workers) {
        await w.close();
      }
    },
  };
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startAllWorkers();
}
