-- supabase/migrations/20260329000000_two_phase_worker.sql
-- Two-phase worker architecture: email batch fan-in barrier, extracted_refs, and atomic RPCs.

-- Fan-in barrier table
CREATE TABLE public.email_message_batches (
  id                           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                       uuid NOT NULL,
  source_message_id            text NOT NULL,
  source_thread_id             text NOT NULL,
  sibling_count                int  NOT NULL,
  phase1_done_count            int  DEFAULT 0 NOT NULL,
  freight_invoice_document_id  uuid,
  phase2_enqueued              boolean DEFAULT false NOT NULL,
  created_at                   timestamptz DEFAULT now(),
  CONSTRAINT email_message_batches_unique UNIQUE (org_id, source_message_id)
);

-- extracted_refs on documents
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS extracted_refs jsonb;

-- document_type CHECK (was unconstrained)
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'FREIGHT_INVOICE','BOL','RATE_SHEET','LUMPER_RECEIPT','DETENTION_NOTICE','OTHER'
  ]));

-- processing_status: add re_auditing
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_processing_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_processing_status_check
  CHECK (processing_status = ANY (ARRAY[
    'pending','processing','rejected','failed','audited','re_auditing','completed'
  ]));

-- RPC: atomically increment phase1_done_count, optionally set freight_invoice_document_id
CREATE OR REPLACE FUNCTION public.increment_batch_phase1(
  p_org_id uuid,
  p_source_message_id text,
  p_freight_invoice_doc_id uuid DEFAULT NULL
) RETURNS SETOF public.email_message_batches AS $$
BEGIN
  RETURN QUERY
  UPDATE public.email_message_batches
  SET
    phase1_done_count = phase1_done_count + 1,
    freight_invoice_document_id = COALESCE(freight_invoice_document_id, p_freight_invoice_doc_id)
  WHERE org_id = p_org_id AND source_message_id = p_source_message_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- RPC: atomic Phase 2 claim — returns true only once per batch
CREATE OR REPLACE FUNCTION public.claim_phase2_enqueue(
  p_org_id uuid,
  p_source_message_id text
) RETURNS boolean AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE public.email_message_batches
  SET phase2_enqueued = true
  WHERE org_id = p_org_id
    AND source_message_id = p_source_message_id
    AND phase2_enqueued = false
    AND phase1_done_count >= sibling_count
    AND freight_invoice_document_id IS NOT NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;
