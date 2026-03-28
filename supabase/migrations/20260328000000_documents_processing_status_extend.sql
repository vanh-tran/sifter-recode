-- Extend documents.processing_status to include worker pipeline states.
-- The BullMQ worker sets 'rejected' for non-freight docs and 'audited' when
-- the full pipeline completes. The existing constraint only covered
-- pending/processing/completed/failed.

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_processing_status_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_processing_status_check
    CHECK (processing_status = ANY (ARRAY[
      'pending',
      'processing',
      'completed',
      'failed',
      'rejected',
      'audited'
    ]));
