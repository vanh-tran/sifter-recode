import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { documentPipelineQueue, gmailSyncQueue, emailEventsQueue } from '@sifter/core/queue/index';

export function startBullBoard(): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');

  createBullBoard({
    queues: [
      new BullMQAdapter(documentPipelineQueue),
      new BullMQAdapter(gmailSyncQueue),
      new BullMQAdapter(emailEventsQueue),
    ],
    serverAdapter,
  });

  const app = express();
  app.use('/', serverAdapter.getRouter());
  app.listen(9999, () => {
    console.log('[board] Bull Board running on :9999 (internal only — use fly proxy 9999)');
  });
}
