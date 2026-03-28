# Two-Phase Worker + Document Linking Design

**Date:** 2026-03-29
**Status:** Approved

## Problem Statement

The current single-phase `document-pipeline` worker has two critical bugs:

1. **Parallel processing race**: When an email contains multiple PDF attachments (invoice + BOL + rate sheet), each gets its own BullMQ job that runs concurrently. The audit agent runs before supporting documents are available, producing findings with no rate or BOL context.

2. **Classification bug**: `runClassifyStage` uses `if (existing?.document_type)` for idempotency. Since `document_type` defaults to `'OTHER'` in the schema, every document is treated as already classified — the LLM is never called. Real freight invoices are rejected immediately.

---

## Architecture Overview

Two BullMQ queues replace the current `document-pipeline` queue:

```
document ingested (email or upload)
        │
        ▼
  [ phase1-queue ]
  OCR + classify + extract_refs
        │
        ├─── source_type = 'upload' ─────────────────────────────────────┐
        │                                                                 │
        └─── source_type = 'email' ──► fan-in barrier ──────────────────►│
                                        all siblings done?               │
                                        yes + FREIGHT_INVOICE found      │
                                                                         ▼
                                                              [ phase2-queue ]
                                                         normalize + link + audit

Re-audit path (follow-up thread docs only):
  non-OTHER doc finishes Phase 1
  → source_message_id differs from invoice's batch message
  → re-enqueue phase2-queue for the related invoice
```

Manual uploads skip the fan-in barrier entirely — Phase 2 fires immediately after Phase 1 completes for a `FREIGHT_INVOICE`.

---

## Phase 1

**Runs for every document.** Triggered on: email attachment ingested by gmail-sync, or manual PDF upload.

**Job payload:** `{ orgId, documentId, gcsKey, sourceType, sourceMessageId?, sourceThreadId? }`

### Steps

1. **OCR** — fetch PDF from GCS, extract raw text, store in MongoDB. Unchanged from current `runOcrStage`.

2. **Classify & categorize** — single LLM call (gpt-4o, json_object) returns:
   - `documentType`: `FREIGHT_INVOICE | BOL | RATE_SHEET | LUMPER_RECEIPT | DETENTION_NOTICE | OTHER`
   - `carrierName`, `invoiceNumber`, `invoiceTotal` (nullable)
   - `confidence` (0–1)

   **Idempotency fix:** skip LLM only if `classification_method IS NOT NULL` (not if `document_type != 'OTHER'`).

   **Prompt fix:** remove "If unsure, set isFreightInvoice to false." Replace with: lean toward `FREIGHT_INVOICE` if the document contains invoice number, carrier name, or line-item charges — even if some fields are missing. Return the most specific type identifiable.

   **Gate for FREIGHT_INVOICE:** require at least one of `carrierName` or `invoiceNumber` (not both required). A real invoice missing its total is still processed — the AI audit can flag math issues.

   Write `document_type`, `classification_confidence`, `classification_method = 'ai'` to `documents`.

3. **Extract refs** — for non-OTHER docs only. Same LLM call as classify (extend the prompt + response schema) to avoid a second round-trip. Extracts all reference numbers present in the OCR text:
   ```json
   {
     "invoiceNumbers": [],
     "bolNumbers": [],
     "proNumbers": [],
     "poNumbers": [],
     "trackingNumbers": [],
     "carrierName": null,
     "shipmentDate": null
   }
   ```
   Stored in `documents.extracted_refs jsonb`.

4. **Fan-in accounting** (email docs only):
   - Atomically: `UPDATE email_message_batches SET phase1_done_count = phase1_done_count + 1 WHERE source_message_id = $1 AND org_id = $2 RETURNING *`
   - If `document_type = 'FREIGHT_INVOICE'`: also set `freight_invoice_document_id = documentId` in the same update
   - If returned row has `phase1_done_count == sibling_count` AND `freight_invoice_document_id IS NOT NULL` AND `phase2_enqueued = false`: enqueue Phase 2, flip `phase2_enqueued = true`
   - Edge case: if FREIGHT_INVOICE is the last doc classified, the same atomic update sets `freight_invoice_document_id` and satisfies the count — Phase 2 is triggered correctly

   For uploads: enqueue Phase 2 directly if `document_type = 'FREIGHT_INVOICE'`.

5. **Re-audit check** (email docs, non-OTHER only):
   - Query `email_message_batches` by `source_thread_id` and `org_id` for all batches in the thread
   - If any batch has a **different** `source_message_id` from this doc AND has a `freight_invoice_document_id` → that invoice was already processed via an earlier message in the thread
   - Re-enqueue Phase 2 for that invoice document (with `isReaudit: true`)

---

## Fan-in Barrier

New table `email_message_batches` — one row per email message containing attachments:

```sql
CREATE TABLE email_message_batches (
  id                           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                       uuid NOT NULL,
  source_message_id            text NOT NULL,
  source_thread_id             text NOT NULL,
  sibling_count                int  NOT NULL,
  phase1_done_count            int  DEFAULT 0 NOT NULL,
  freight_invoice_document_id  uuid,
  phase2_enqueued              boolean DEFAULT false NOT NULL,
  created_at                   timestamptz DEFAULT now(),
  UNIQUE (org_id, source_message_id)
);
```

`gmail-sync` writes this record **before** enqueueing any document jobs for a message. It already iterates all attachments, so `sibling_count` is known upfront.

The `phase2_enqueued` flag prevents double-enqueue in the event of concurrent Phase 1 completions for the last batch of siblings (both would see the count match; only the one that flips the flag wins).

---

## Phase 2

**Runs for FREIGHT_INVOICE documents only.**

**Job payload:** `{ orgId, documentId, isReaudit: boolean }`

### Steps

1. **Normalize** — unchanged: extract structured fields via LLM, upsert `invoices` + `invoice_line_items`, upsert carrier. Returns `invoiceId`.

2. **Link (gather-context)** — the definitive linking step. Collects candidate documents in three groups, then deduplicates by document ID before passing to the linking agent:

   - **Group 1 — Thread match**: all non-OTHER documents sharing `source_thread_id` with this document. Queried from `documents` table with their `extracted_refs`.
   - **Group 2 — Ref cross-match**: all non-OTHER documents in the same org whose `extracted_refs` overlap with the invoice's own `extracted_refs` (invoice numbers, BOL numbers, PRO numbers, etc.).
   - **Group 3 — Carrier + date window**: documents with the same `carrier_id` whose `extracted_refs.shipmentDate` falls within ±7 days of the invoice date.

   **Dedup:** merge all three groups into a single set keyed by document ID — a doc that appears in multiple groups is included once.

   **Linking agent prompt**: receives the invoice's normalized fields + extracted refs, plus the candidate list (document ID, type, filename, extracted_refs for each). The agent reasons over all candidates and returns a scored list: `[{ documentId, refType, linkConfidence, reasoning }]`.

   No heuristic code for type hints — all signals (thread membership, filename, proximity) are provided as data to the agent prompt, not as code-level filters.

   Writes results to `invoice_references`:
   ```
   invoice_id, ref_type, ref_value, related_document_id, link_confidence, link_method = 'ai'
   ```
   Upserts (insert or update) — safe to re-run on re-audit.

3. **Pre-gather context** — fetch OCR text from MongoDB for each linked document:
   - Invoice raw OCR text (from Phase 1)
   - Each linked BOL's raw OCR text
   - Rate sheet: via `rate_sheets.document_id` → `documents.mongodb_document_id` → MongoDB raw text
   - Rate sheet text truncated at 40k chars; BOL texts truncated at 20k chars each

4. **Audit** — pass pre-gathered content to `runAiAuditAgent`:
   ```typescript
   {
     invoiceJson,          // normalized structured fields
     invoiceRawText,       // raw OCR text
     rateSheetText?,       // raw OCR text from rate sheet document
     bolTexts?,            // string[] — one per linked BOL
     deterministicFindings
   }
   ```
   Deterministic checks run first (unchanged). AI audit receives all context, not just metadata.

   **For re-audit**: delete existing findings for `invoiceId` before inserting new ones. Set `processing_status = 're_auditing'` at job start, `'audited'` on completion.

---

## DB Changes

### New table
`email_message_batches` — see schema above.

### New column on `documents`
```sql
ALTER TABLE documents ADD COLUMN extracted_refs jsonb;
```

### Updated constraints on `documents`

**document_type** (currently unconstrained — add CHECK):
```sql
ALTER TABLE documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'FREIGHT_INVOICE','BOL','RATE_SHEET',
    'LUMPER_RECEIPT','DETENTION_NOTICE','OTHER'
  ]));
```

**processing_status** (add `re_auditing`):
```sql
ALTER TABLE documents DROP CONSTRAINT documents_processing_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_processing_status_check
  CHECK (processing_status = ANY (ARRAY[
    'pending','processing','rejected','failed','audited','re_auditing'
  ]));
```

---

## Classification Fix Summary

| | Before | After |
|---|---|---|
| Idempotency check | `if (existing?.document_type)` — always true (default 'OTHER') | `if (existing?.classification_method)` — only true after real classification |
| Output type field | `isFreightInvoice: boolean` | `documentType: FREIGHT_INVOICE \| BOL \| RATE_SHEET \| ...` |
| Uncertain docs | Default to OTHER | Lean toward most specific type; only OTHER if clearly non-invoice |
| Gate strictness | Requires carrierName + invoiceNumber + invoiceTotal (all three) | Requires at least one of carrierName or invoiceNumber |

---

## Queue Summary

| Queue | Triggered by | Handler |
|---|---|---|
| `phase1-queue` | gmail-sync (per attachment), upload route (per upload) | OCR + classify + extract_refs + fan-in accounting |
| `phase2-queue` | fan-in barrier (email), Phase 1 completion (upload), re-audit check | normalize + link + pre-gather + audit |

The existing `document-pipeline` queue is removed. `email-events-queue` and `gmail-sync-queue` are unchanged.

---

## Out of Scope (Post-MVP)

- Amount plausibility matching (rate sheet line items vs invoice line items)
- Manual link/unlink UI for documents
- Email notifications on re-audit completion
