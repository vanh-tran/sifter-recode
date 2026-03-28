import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { DocumentPipelinePayload, Phase1Payload, Phase2Payload, GmailSyncPayload, EmailEventsPayload } from './types.js';

let _redis: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) throw new Error('UPSTASH_REDIS_URL is not set');
    _redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return _redis;
}

/** Defer BullMQ construction until first use so Next.js can import routes without Redis at build time. */
function lazyQueue<T>(create: () => Queue<T>): Queue<T> {
  let instance: Queue<T> | null = null;
  return new Proxy({} as Queue<T>, {
    get(_target, prop) {
      if (!instance) instance = create();
      const value = Reflect.get(instance, prop, instance);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
    },
  });
}

export const documentPipelineQueue = lazyQueue<DocumentPipelinePayload>(() =>
  new Queue<DocumentPipelinePayload>('document-pipeline', { connection: getRedisConnection() })
);

export const phase1Queue = lazyQueue<Phase1Payload>(() =>
  new Queue<Phase1Payload>('phase1', { connection: getRedisConnection() })
);

export const phase2Queue = lazyQueue<Phase2Payload>(() =>
  new Queue<Phase2Payload>('phase2', { connection: getRedisConnection() })
);

export const gmailSyncQueue = lazyQueue<GmailSyncPayload>(() =>
  new Queue<GmailSyncPayload>('gmail-sync', { connection: getRedisConnection() })
);

export const emailEventsQueue = lazyQueue<EmailEventsPayload>(() =>
  new Queue<EmailEventsPayload>('email-events', { connection: getRedisConnection() })
);
