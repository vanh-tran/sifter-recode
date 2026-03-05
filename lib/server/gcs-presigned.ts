/**
 * GCS Presigned URL utility for API routes
 * 
 * Generates presigned URLs for secure PDF access
 */

import { Storage } from '@google-cloud/storage';

const MIN_URL_EXPIRY_MINUTES = 1;
const MAX_URL_EXPIRY_MINUTES = 60;

// Initialize GCS client
const getStorageClient = () => {
  const gcpCredentialsJson = process.env.GCP_CREDENTIALS_JSON;
  if (gcpCredentialsJson) {
    try {
      const credentials = JSON.parse(Buffer.from(gcpCredentialsJson, 'base64').toString('utf8'));
      return new Storage({ credentials });
    } catch (error) {
      console.error('Failed to parse GCP_CREDENTIALS_JSON:', error);
      throw new Error('Invalid GCP_CREDENTIALS_JSON format');
    }
  }

  return new Storage();
};

const storage = getStorageClient();

function normalizeGcsKey(gcsKey: string): string {
  const decoded = decodeURIComponent(gcsKey);
  const normalized = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  // Block path traversal attempts regardless of encoding
  if (normalized.includes('..') || normalized.includes('//')) {
    throw new Error('Invalid GCS key format');
  }
  return normalized;
}

function getScopedGcsKey(gcsKey: string, orgId: string): string {
  const normalizedKey = normalizeGcsKey(gcsKey);
  const expectedPrefix = `orgs/${orgId}/`;
  if (!normalizedKey.startsWith(expectedPrefix)) {
    throw new Error('Access denied for requested file');
  }
  return normalizedKey;
}

function clampExpiryMinutes(expiresInMinutes: number): number {
  if (!Number.isFinite(expiresInMinutes)) return 15;
  return Math.min(
    Math.max(Math.floor(expiresInMinutes), MIN_URL_EXPIRY_MINUTES),
    MAX_URL_EXPIRY_MINUTES
  );
}

/**
 * Generate a presigned URL for a GCS object
 * 
 * @param gcsKey - GCS key/path (e.g., "orgs/123/documents/timestamp-filename.pdf")
 * @param orgId - Organization ID used to enforce key scoping
 * @param expiresInMinutes - URL expiration time (default: 15 minutes)
 * @returns Presigned URL
 */
export async function generatePresignedUrl(
  gcsKey: string,
  orgId: string,
  expiresInMinutes: number = 15
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('Missing GCS_BUCKET_NAME environment variable');
  }
  if (!orgId) {
    throw new Error('Missing orgId for presigned URL generation');
  }

  const scopedGcsKey = getScopedGcsKey(gcsKey, orgId);
  const safeExpiresInMinutes = clampExpiryMinutes(expiresInMinutes);

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(scopedGcsKey);

  // Check if file exists and is a PDF
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error('Requested file was not found');
  }

  const [metadata] = await file.getMetadata();
  if (!metadata.contentType?.startsWith('application/pdf')) {
    throw new Error('Only PDF files are supported');
  }

  // Generate presigned URL (valid for specified duration)
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + safeExpiresInMinutes * 60 * 1000,
  });

  return url;
}

