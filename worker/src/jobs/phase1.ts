// worker/src/jobs/phase1.ts
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import type { Phase1Payload } from '@sifter/core/queue/types';
import { phase2Queue } from '@sifter/core/queue/index';
import { runOcrStage } from '../stages/ocr.js';
import { runClassifyStage } from '../stages/classify.js';
import { runFanInBarrier } from '../stages/fan-in.js';

export async function handlePhase1(
  job: Job<Phase1Payload>,
  supabase: SupabaseClient,
  db: Db
): Promise<void> {
  const { orgId, documentId, gcsKey, sourceType, sourceMessageId, sourceThreadId } = job.data;

  await supabase
    .from('documents')
    .update({ processing_status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId);

  const mongoDocId = await runOcrStage(supabase, db, { orgId, documentId, gcsKey });
  const classifyResult = await runClassifyStage(supabase, db, { orgId, documentId, mongoDocId });

  if (sourceType === 'email' && sourceMessageId) {
    await runFanInBarrier(supabase, {
      orgId,
      sourceMessageId,
      isFreightInvoice: classifyResult.documentType === 'FREIGHT_INVOICE',
      documentId,
    });

    // Re-audit: if a non-OTHER supporting doc arrives in a thread with an already-audited invoice
    if (!classifyResult.rejected && classifyResult.documentType !== 'FREIGHT_INVOICE' && sourceThreadId) {
      await triggerReauditForThread(supabase, { orgId, sourceMessageId, sourceThreadId });
    }
  } else if (sourceType === 'upload' && classifyResult.documentType === 'FREIGHT_INVOICE') {
    await phase2Queue.add(
      `phase2-${documentId}`,
      { orgId, documentId, isReaudit: false },
      { jobId: `phase2-${documentId}` }
    );
  }

  if (classifyResult.rejected) {
    await supabase
      .from('documents')
      .update({ processing_status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('org_id', orgId);
  }
}

async function triggerReauditForThread(
  supabase: SupabaseClient,
  { orgId, sourceMessageId, sourceThreadId }: { orgId: string; sourceMessageId: string; sourceThreadId: string }
): Promise<void> {
  // Find batches in the same thread with a DIFFERENT source_message_id that have an audited invoice
  const { data: relatedBatches } = await supabase
    .from('email_message_batches')
    .select('freight_invoice_document_id')
    .eq('org_id', orgId)
    .eq('source_thread_id', sourceThreadId)
    .neq('source_message_id', sourceMessageId)
    .not('freight_invoice_document_id', 'is', null);

  if (!relatedBatches?.length) return;

  for (const batch of relatedBatches) {
    const invoiceDocId = batch.freight_invoice_document_id as string;
    const { data: doc } = await supabase
      .from('documents')
      .select('processing_status')
      .eq('id', invoiceDocId)
      .eq('org_id', orgId)
      .single();

    if (doc?.processing_status !== 'audited') continue;

    await supabase
      .from('documents')
      .update({ processing_status: 're_auditing', updated_at: new Date().toISOString() })
      .eq('id', invoiceDocId)
      .eq('org_id', orgId);

    await phase2Queue.add(
      `phase2-reaudit-${invoiceDocId}`,
      { orgId, documentId: invoiceDocId, isReaudit: true },
      { jobId: `phase2-reaudit-${invoiceDocId}`, removeOnComplete: true, removeOnFail: true }
    );
  }
}
