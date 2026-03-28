import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import type { DocumentPipelinePayload } from '@sifter/core/queue/types.js';
import { runOcrStage } from '../stages/ocr.js';
import { runClassifyStage } from '../stages/classify.js';
import { runNormalizeStage } from '../stages/normalize.js';
import { runGatherContextStage } from '../stages/gather-context.js';
import { runPostAuditStage } from '../stages/post-audit.js';

export async function handleDocumentPipeline(
  job: Job<DocumentPipelinePayload>,
  supabase: SupabaseClient,
  db: Db
): Promise<void> {
  const { orgId, documentId, gcsKey } = job.data;

  await supabase
    .from('documents')
    .update({ processing_status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId);

  const mongoDocId = await runOcrStage(supabase, db, { orgId, documentId, gcsKey });

  const classifyResult = await runClassifyStage(supabase, db, { orgId, documentId, mongoDocId });
  if (classifyResult.rejected) return;

  const invoiceId = await runNormalizeStage(supabase, db, { orgId, documentId, mongoDocId });

  const { bolDocumentIds, rateSheetId } = await runGatherContextStage(supabase, { orgId, invoiceId });

  await runPostAuditStage(supabase, { orgId, invoiceId, bolDocumentIds, rateSheetId });

  await supabase
    .from('documents')
    .update({ processing_status: 'audited', updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId);
}
