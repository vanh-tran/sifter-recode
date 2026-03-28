import 'dotenv/config';
import { gmailSyncQueue, documentPipelineQueue, emailEventsQueue } from '@sifter/core/queue/index';
import { createWorkers } from './workers.js';
import { startAutoscaler } from './scaler.js';
import { startBullBoard } from './board.js';

async function main() {
  console.log('[worker] Starting sifter-worker...');

  await gmailSyncQueue.add(
    'sync-all',
    {},
    {
      repeat: { pattern: '*/15 * * * *' },
      jobId: 'gmail-sync-cron',
    }
  );

  const workers = createWorkers();
  console.log(`[worker] ${workers.length} workers started`);

  const getQueueDepth = async () => {
    const counts = await Promise.all([
      documentPipelineQueue.getJobCounts('waiting', 'active'),
      gmailSyncQueue.getJobCounts('waiting', 'active'),
      emailEventsQueue.getJobCounts('waiting', 'active'),
    ]);
    return counts.reduce((sum, c) => sum + (c.waiting ?? 0) + (c.active ?? 0), 0);
  };

  startAutoscaler(getQueueDepth);

  startBullBoard();

  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM received, draining workers...');
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });

  console.log('[worker] Ready.');
}

main().catch((err) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
