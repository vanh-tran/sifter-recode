import type { SupabaseClient } from '@supabase/supabase-js';
import { phase2Queue } from '@sifter/core/queue/index';
import type { Phase2Payload } from '@sifter/core/queue/types';

export interface BatchRow {
  phase1_done_count: number;
  sibling_count: number;
  freight_invoice_document_id: string | null;
  phase2_enqueued: boolean;
}

/** Pure — testable without DB. */
export function shouldEnqueuePhase2(batch: BatchRow): boolean {
  return (
    batch.phase1_done_count >= batch.sibling_count &&
    batch.freight_invoice_document_id !== null &&
    !batch.phase2_enqueued
  );
}

export async function runFanInBarrier(
  supabase: SupabaseClient,
  {
    orgId,
    sourceMessageId,
    isFreightInvoice,
    documentId,
  }: {
    orgId: string;
    sourceMessageId: string;
    isFreightInvoice: boolean;
    documentId: string;
  }
): Promise<void> {
  const { data: batch, error: batchError } = await supabase.rpc('increment_batch_phase1', {
    p_org_id: orgId,
    p_source_message_id: sourceMessageId,
    p_freight_invoice_doc_id: isFreightInvoice ? documentId : null,
  });

  if (batchError) {
    throw new Error(`fan-in: increment_batch_phase1 failed for message ${sourceMessageId}: ${batchError.message}`);
  }

  const row: BatchRow | null = Array.isArray(batch) ? batch[0] ?? null : (batch as BatchRow | null);
  if (!row || !shouldEnqueuePhase2(row)) return;

  const { data: claimed, error: claimError } = await supabase.rpc('claim_phase2_enqueue', {
    p_org_id: orgId,
    p_source_message_id: sourceMessageId,
  });

  if (claimError) {
    throw new Error(`fan-in: claim_phase2_enqueue failed for message ${sourceMessageId}: ${claimError.message}`);
  }

  if (!claimed) return; // Another worker won the race — idempotent, silent

  await phase2Queue.add(
    `phase2-${row.freight_invoice_document_id}`,
    {
      orgId,
      documentId: row.freight_invoice_document_id as string,
      isReaudit: false,
    } satisfies Phase2Payload,
    { jobId: `phase2-${row.freight_invoice_document_id}` }
  );
}
