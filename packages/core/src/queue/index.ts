import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { DocumentPipelinePayload, GmailSyncPayload, EmailEventsPayload } from './types.js';

let _redis: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) throw new Error('UPSTASH_REDIS_URL is not set');
    _redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return _redis;
}

export const documentPipelineQueue = new Queue<DocumentPipelinePayload>(
  'document-pipeline',
  { connection: getRedisConnection() }
);

export const gmailSyncQueue = new Queue<GmailSyncPayload>(
  'gmail-sync',
  { connection: getRedisConnection() }
);

export const emailEventsQueue = new Queue<EmailEventsPayload>(
  'email-events',
  { connection: getRedisConnection() }
);
