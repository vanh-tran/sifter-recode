import { Worker } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { getMongoDb } from '@sifter/core/mongodb/client';
import { getRedisConnection } from '@sifter/core/queue/index';
import { handleDocumentPipeline } from './jobs/document-pipeline.js';
import { handleGmailSync } from './jobs/gmail-sync.js';
import { handleEmailEvents } from './jobs/email-events.js';

export function createWorkers(): Worker[] {
  const connection = getRedisConnection();

  const documentWorker = new Worker(
    'document-pipeline',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handleDocumentPipeline(job, supabase, db);
    },
    { connection, concurrency: 3, lockDuration: 600_000 }
  );

  const gmailWorker = new Worker(
    'gmail-sync',
    async () => {
      await handleGmailSync();
    },
    { connection, concurrency: 1 }
  );

  const emailWorker = new Worker(
    'email-events',
    async (job) => {
      await handleEmailEvents(job);
    },
    { connection, concurrency: 5 }
  );

  const pairs: Array<{ worker: Worker; label: string }> = [
    { worker: documentWorker, label: 'document-pipeline' },
    { worker: gmailWorker, label: 'gmail-sync' },
    { worker: emailWorker, label: 'email-events' },
  ];

  for (const { worker, label } of pairs) {
    worker.on('failed', (job, err) => {
      console.error(`[${label}] Job ${job?.id} failed:`, err.message);
    });
  }

  return [documentWorker, gmailWorker, emailWorker];
}
