import { Storage } from '@google-cloud/storage';

export function getStorage(): Storage {
  const raw = process.env.GCP_CREDENTIALS_JSON;
  if (!raw) throw new Error('GCP_CREDENTIALS_JSON is not set');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new Storage({ credentials });
}
