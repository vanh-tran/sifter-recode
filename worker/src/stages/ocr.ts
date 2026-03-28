import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import { extractTextFromPdfBuffer } from '@sifter/core/ocr/extract-text.js';

interface OcrStageInput {
  orgId: string;
  documentId: string;
  gcsKey: string;
}

/**
 * Idempotent: skips if mongodb_document_id is already set.
 * Returns the MongoDB document ID.
 */
export async function runOcrStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, gcsKey }: OcrStageInput
): Promise<string> {
  const { data: existing } = await supabase
    .from('documents')
    .select('mongodb_document_id')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .single();

  if (existing?.mongodb_document_id) {
    return existing.mongodb_document_id as string;
  }

  const storage = new Storage();
  const [buf] = await storage.bucket(process.env.GCS_BUCKET!).file(gcsKey).download();
  const rawText = await extractTextFromPdfBuffer(buf as Buffer);

  const mongoId = randomUUID();
  await db.collection('document_ocr').insertOne({
    _id: mongoId as unknown as import('mongodb').ObjectId,
    orgId,
    documentId,
    rawText,
    createdAt: new Date(),
  });

  await supabase
    .from('documents')
    .update({ mongodb_document_id: mongoId, updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId);

  return mongoId;
}
