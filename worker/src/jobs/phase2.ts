// worker/src/jobs/phase2.ts
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import type { Phase2Payload } from '@sifter/core/queue/types';
import { runNormalizeStage } from '../stages/normalize.js';
import { runLinkDocumentsStage } from '../stages/link-documents.js';
import { runPreGatherStage } from '../stages/pre-gather.js';
import { runPostAuditStage } from '../stages/post-audit.js';
import type { ExtractedRefs } from '@sifter/core/llm/classify-invoice';

const EMPTY_REFS: ExtractedRefs = {
  invoiceNumbers: [], bolNumbers: [], proNumbers: [],
  poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null,
};

export async function handlePhase2(
  job: Job<Phase2Payload>,
  supabase: SupabaseClient,
  db: Db
): Promise<void> {
  const { orgId, documentId, isReaudit } = job.data;

  // For re-audit: clear existing AI-generated findings so idempotency check doesn't skip
  if (isReaudit) {
    const { data: inv } = await supabase
      .from('invoices').select('id')
      .eq('document_id', documentId).eq('org_id', orgId).maybeSingle();
    if (inv?.id) {
      await supabase.from('findings')
        .delete().eq('invoice_id', inv.id).eq('org_id', orgId);
    }
  }

  // Step 1: Normalize
  const { data: docRow, error: docErr } = await supabase
    .from('documents').select('mongodb_document_id, source_thread_id, extracted_refs')
    .eq('id', documentId).eq('org_id', orgId).single();
  if (docErr) throw new Error(`phase2: failed to fetch document ${documentId}: ${docErr.message}`);

  const mongoDocId = docRow?.mongodb_document_id ?? '';
  const invoiceId = await runNormalizeStage(supabase, db, { orgId, documentId, mongoDocId });

  // Load carrier and date for linking
  const { data: inv, error: invErr } = await supabase
    .from('invoices').select('carrier_id, invoice_date')
    .eq('id', invoiceId).eq('org_id', orgId).single();
  if (invErr) throw new Error(`phase2: failed to fetch invoice ${invoiceId}: ${invErr.message}`);

  // Step 2: Link
  await runLinkDocumentsStage(supabase, {
    orgId,
    invoiceId,
    invoiceDocumentId: documentId,
    invoiceExtractedRefs: (docRow?.extracted_refs as ExtractedRefs) ?? EMPTY_REFS,
    invoiceCarrierId: inv?.carrier_id ?? null,
    invoiceDate: inv?.invoice_date ?? null,
    sourceThreadId: docRow?.source_thread_id ?? null,
  });

  // Step 3: Pre-gather
  const context = await runPreGatherStage(supabase, db, {
    orgId, invoiceId, invoiceDocumentId: documentId,
  });

  // Step 4: Audit
  await runPostAuditStage(supabase, { orgId, invoiceId, preGatheredContext: context });

  const { error: finalErr } = await supabase
    .from('documents')
    .update({ processing_status: 'audited', updated_at: new Date().toISOString() })
    .eq('id', documentId).eq('org_id', orgId);
  if (finalErr) throw new Error(`phase2: failed to set audited status for document ${documentId}: ${finalErr.message}`);
}
