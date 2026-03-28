import { Worker } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { getMongoDb } from '@sifter/core/mongodb/client';
import { getRedisConnection } from '@sifter/core/queue/index';
import { handlePhase1 } from './jobs/phase1.js';
import { handlePhase2 } from './jobs/phase2.js';
import { handleGmailSync } from './jobs/gmail-sync.js';
import { handleEmailEvents } from './jobs/email-events.js';

export function createWorkers(): Worker[] {
  const connection = getRedisConnection();

  const phase1Worker = new Worker(
    'phase1',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handlePhase1(job, supabase, db);
    },
    { connection, concurrency: 5, lockDuration: 300_000 }
  );

  const phase2Worker = new Worker(
    'phase2',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handlePhase2(job, supabase, db);
    },
    { connection, concurrency: 2, lockDuration: 600_000 }
  );

  const gmailWorker = new Worker(
    'gmail-sync',
    async () => { await handleGmailSync(); },
    { connection, concurrency: 1 }
  );

  const emailWorker = new Worker(
    'email-events',
    async (job) => { await handleEmailEvents(job); },
    { connection, concurrency: 5 }
  );

  const pairs = [
    { worker: phase1Worker, label: 'phase1' },
    { worker: phase2Worker, label: 'phase2' },
    { worker: gmailWorker, label: 'gmail-sync' },
    { worker: emailWorker, label: 'email-events' },
  ];

  for (const { worker, label } of pairs) {
    worker.on('failed', (job, err) => {
      console.error(`[${label}] Job ${job?.id} failed:`, err.message);
    });
  }

  return [phase1Worker, phase2Worker, gmailWorker, emailWorker];
}
