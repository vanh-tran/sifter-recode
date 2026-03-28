# Two-Phase Worker + Document Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `document-pipeline` queue with two phases — Phase 1 (OCR + classify + extract refs) and Phase 2 (normalize + link + audit) — with a fan-in barrier for same-message email attachments and a re-audit trigger for follow-up thread documents.

**Architecture:** Every document enters `phase1-queue` immediately. For email docs, an `email_message_batches` fan-in barrier ensures Phase 2 only fires after all siblings in the same message finish Phase 1. Phase 2 runs a linking agent (3 candidate groups, deduped by doc ID) then pre-gathers OCR text from MongoDB before calling the audit agent. A re-audit path re-enqueues Phase 2 when a new supporting doc arrives in an existing thread.

**Tech Stack:** BullMQ, Upstash Redis, Supabase (service role + RPC), MongoDB (OCR text), OpenAI gpt-4o (json_object), Vitest

---

## File Map

**New files:**
- `supabase/migrations/20260329000000_two_phase_worker.sql`
- `worker/src/jobs/phase1.ts`
- `worker/src/jobs/phase2.ts`
- `worker/src/stages/fan-in.ts`
- `worker/src/stages/link-documents.ts`
- `worker/src/stages/pre-gather.ts`
- `__tests__/worker/classify-core.test.ts`
- `__tests__/worker/fan-in.test.ts`
- `__tests__/worker/link-documents.test.ts`

**Modified files:**
- `packages/core/src/queue/types.ts` — add Phase1Payload, Phase2Payload
- `packages/core/src/queue/index.ts` — add phase1Queue, phase2Queue
- `packages/core/src/llm/classify-invoice.ts` — new prompt + DocumentType enum + ExtractedRefs
- `packages/core/src/audit/ai-audit-agent.ts` — accept invoiceRawText, rateSheetText, bolTexts
- `worker/src/stages/classify.ts` — fix idempotency; use new classify fn; write extracted_refs
- `worker/src/stages/post-audit.ts` — accept PreGatheredContext instead of bolDocumentIds/rateSheetId
- `worker/src/jobs/gmail-sync.ts` — write email_message_batches; enqueue phase1Queue
- `worker/src/workers.ts` — register phase1Worker, phase2Worker; remove documentWorker
- `worker/src/board.ts` — swap queues on Bull Board
- `app/api/documents/upload/route.ts` — enqueue phase1Queue

**Deleted files:**
- `worker/src/jobs/document-pipeline.ts`
- `worker/src/stages/gather-context.ts` (replaced by link-documents + pre-gather)

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260329000000_two_phase_worker.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260329000000_two_phase_worker.sql

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
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'FREIGHT_INVOICE','BOL','RATE_SHEET','LUMPER_RECEIPT','DETENTION_NOTICE','OTHER'
  ]));

-- processing_status: add re_auditing
ALTER TABLE public.documents DROP CONSTRAINT documents_processing_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_processing_status_check
  CHECK (processing_status = ANY (ARRAY[
    'pending','processing','rejected','failed','audited','re_auditing'
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
```

- [ ] **Step 2: Apply migration locally**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode
npx supabase db push
```

Expected: migration applied without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260329000000_two_phase_worker.sql
git commit -m "feat: add email_message_batches, extracted_refs, document_type constraint, phase1/2 RPCs"
```

---

### Task 2: Queue Types and Instances

**Files:**
- Modify: `packages/core/src/queue/types.ts`
- Modify: `packages/core/src/queue/index.ts`

- [ ] **Step 1: Update types.ts**

Replace the entire file:

```typescript
// packages/core/src/queue/types.ts

export interface Phase1Payload {
  orgId: string;
  documentId: string;
  gcsKey: string;
  sourceType: 'upload' | 'email';
  sourceMessageId?: string;
  sourceThreadId?: string;
}

export interface Phase2Payload {
  orgId: string;
  documentId: string;
  isReaudit: boolean;
}

/** No fields — worker syncs all active Gmail connections. */
export type GmailSyncPayload = Record<string, never>;

export interface EmailEventsPayload {
  orgId: string;
  threadId: string;
  messageId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  receivedAt: string;
}
```

- [ ] **Step 2: Add phase1Queue and phase2Queue to index.ts**

Add after the existing `documentPipelineQueue` export (keep it for now — removed in Task 14):

```typescript
// packages/core/src/queue/index.ts — add these two exports

export const phase1Queue = lazyQueue<Phase1Payload>(() =>
  new Queue<Phase1Payload>('phase1', { connection: getRedisConnection() })
);

export const phase2Queue = lazyQueue<Phase2Payload>(() =>
  new Queue<Phase2Payload>('phase2', { connection: getRedisConnection() })
);
```

Add the missing imports at the top (Phase1Payload and Phase2Payload are already in types.ts):

```typescript
import type { DocumentPipelinePayload, GmailSyncPayload, EmailEventsPayload, Phase1Payload, Phase2Payload } from './types.js';
```

- [ ] **Step 3: Build core and verify no type errors**

```bash
cd packages/core && pnpm build
```

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/queue/types.ts packages/core/src/queue/index.ts
git commit -m "feat: add Phase1Payload, Phase2Payload, phase1Queue, phase2Queue"
```

---

### Task 3: Classification Core — New Prompt, DocumentType, ExtractedRefs

**Files:**
- Modify: `packages/core/src/llm/classify-invoice.ts`
- Create: `__tests__/worker/classify-core.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/worker/classify-core.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateClassificationGate } from '../../packages/core/src/llm/classify-invoice';
import type { ClassificationResult } from '../../packages/core/src/llm/classify-invoice';

const baseRefs = {
  invoiceNumbers: [], bolNumbers: [], proNumbers: [],
  poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null,
};

describe('evaluateClassificationGate', () => {
  it('passes FREIGHT_INVOICE with carrierName', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: 'Acme Freight',
      invoiceNumber: null, invoiceTotal: null, confidence: 0.9,
      extractedRefs: { ...baseRefs, carrierName: 'Acme Freight' },
    };
    expect(evaluateClassificationGate(c).pass).toBe(true);
  });

  it('passes FREIGHT_INVOICE with invoiceNumber but no carrierName', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: null,
      invoiceNumber: 'INV-001', invoiceTotal: null, confidence: 0.8,
      extractedRefs: { ...baseRefs, invoiceNumbers: ['INV-001'] },
    };
    expect(evaluateClassificationGate(c).pass).toBe(true);
  });

  it('rejects FREIGHT_INVOICE missing both carrierName and invoiceNumber', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: null,
      invoiceNumber: null, invoiceTotal: 1200, confidence: 0.6,
      extractedRefs: baseRefs,
    };
    const result = evaluateClassificationGate(c);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('carrier name and invoice number');
  });

  it('rejects BOL document type', () => {
    const c: ClassificationResult = {
      documentType: 'BOL', carrierName: 'Acme', invoiceNumber: 'BOL-123',
      invoiceTotal: null, confidence: 0.95, extractedRefs: baseRefs,
    };
    expect(evaluateClassificationGate(c).pass).toBe(false);
    expect(evaluateClassificationGate(c).reason).toContain('BOL');
  });

  it('rejects RATE_SHEET document type', () => {
    const c: ClassificationResult = {
      documentType: 'RATE_SHEET', carrierName: 'Acme', invoiceNumber: null,
      invoiceTotal: null, confidence: 0.9, extractedRefs: baseRefs,
    };
    expect(evaluateClassificationGate(c).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm test __tests__/worker/classify-core.test.ts
```

Expected: FAIL — `ClassificationResult` and `evaluateClassificationGate` with new signature not found yet.

- [ ] **Step 3: Replace classify-invoice.ts**

```typescript
// packages/core/src/llm/classify-invoice.ts

export type DocumentType =
  | 'FREIGHT_INVOICE'
  | 'BOL'
  | 'RATE_SHEET'
  | 'LUMPER_RECEIPT'
  | 'DETENTION_NOTICE'
  | 'OTHER';

export interface ExtractedRefs {
  invoiceNumbers: string[];
  bolNumbers: string[];
  proNumbers: string[];
  poNumbers: string[];
  trackingNumbers: string[];
  carrierName: string | null;
  shipmentDate: string | null;
}

export interface ClassificationResult {
  documentType: DocumentType;
  carrierName: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  confidence: number;
  extractedRefs: ExtractedRefs;
}

export function evaluateClassificationGate(c: ClassificationResult): { pass: boolean; reason?: string } {
  if (c.documentType !== 'FREIGHT_INVOICE') {
    return { pass: false, reason: `Document classified as ${c.documentType}` };
  }
  if (!c.carrierName?.trim() && !c.invoiceNumber?.trim()) {
    return { pass: false, reason: 'Missing both carrier name and invoice number' };
  }
  return { pass: true };
}

export const CLASSIFY_DOCUMENT_PROMPT = `You are a document classifier for accounts payable.
Given raw OCR text from a PDF, return a JSON object with these keys:

documentType (string): the most specific type from:
  FREIGHT_INVOICE — a freight/logistics carrier invoice containing line item charges, amounts, or billing references. Lean toward this type if the document looks like an invoice, even if some fields are missing.
  BOL — Bill of Lading or proof of delivery document
  RATE_SHEET — carrier rate card or tariff schedule
  LUMPER_RECEIPT — lumper or unloading service receipt
  DETENTION_NOTICE — detention or layover notice
  OTHER — only if clearly none of the above

carrierName (string|null): carrier or logistics company name, if present
invoiceNumber (string|null): invoice or billing reference number, if present
invoiceTotal (number|null): total amount due in USD, if stated; else null
confidence (number 0-1): your confidence in the classification

extractedRefs (object): all reference identifiers found in the document:
  invoiceNumbers: string[]
  bolNumbers: string[]
  proNumbers: string[]
  poNumbers: string[]
  trackingNumbers: string[]
  carrierName: string|null
  shipmentDate: string|null  (ISO 8601 date if found, else null)

Do not invent values. Extract only what is present in the OCR text.`;

export async function classifyDocument(
  rawText: string,
  callOpenAI: (prompt: string) => Promise<string>
): Promise<ClassificationResult> {
  const raw = await callOpenAI(
    `${CLASSIFY_DOCUMENT_PROMPT}\n\n--- OCR TEXT ---\n${rawText.slice(0, 120_000)}`
  );
  return JSON.parse(raw) as ClassificationResult;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test __tests__/worker/classify-core.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Build core**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm/classify-invoice.ts __tests__/worker/classify-core.test.ts
git commit -m "feat: new DocumentType enum, ExtractedRefs, inclusive classification gate"
```

---

### Task 4: Fix Classify Stage

**Files:**
- Modify: `worker/src/stages/classify.ts`

- [ ] **Step 1: Replace classify.ts**

```typescript
// worker/src/stages/classify.ts
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import {
  classifyDocument,
  evaluateClassificationGate,
  type DocumentType,
  type ExtractedRefs,
} from '@sifter/core/llm/classify-invoice';

interface ClassifyStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

export interface ClassifyStageResult {
  documentType: DocumentType;
  extractedRefs: ExtractedRefs;
  rejected: boolean;
  reason?: string;
}

const EMPTY_REFS: ExtractedRefs = {
  invoiceNumbers: [], bolNumbers: [], proNumbers: [],
  poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null,
};

/**
 * Idempotent: skips LLM call if classification_method is already set.
 */
export async function runClassifyStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: ClassifyStageInput
): Promise<ClassifyStageResult> {
  const { data: existing } = await supabase
    .from('documents')
    .select('document_type, classification_method, extracted_refs')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .single();

  if (existing?.classification_method) {
    return {
      documentType: existing.document_type as DocumentType,
      extractedRefs: (existing.extracted_refs as ExtractedRefs) ?? EMPTY_REFS,
      rejected: existing.document_type !== 'FREIGHT_INVOICE',
    };
  }

  const doc = await db.collection('document_ocr').findOne({
    _id: mongoDocId as unknown as import('mongodb').ObjectId,
  });
  const ocrText = (doc?.rawText as string) ?? '';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const classification = await classifyDocument(ocrText, async (p: string) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: p }],
    });
    return res.choices[0]?.message?.content ?? '{}';
  });

  const gate = evaluateClassificationGate(classification);

  await supabase
    .from('documents')
    .update({
      document_type: classification.documentType,
      classification_confidence: classification.confidence,
      classification_method: 'ai',
      extracted_refs: classification.extractedRefs,
      processing_status: gate.pass ? 'processing' : 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('org_id', orgId);

  return {
    documentType: classification.documentType,
    extractedRefs: classification.extractedRefs,
    rejected: !gate.pass,
    reason: gate.reason,
  };
}
```

- [ ] **Step 2: Build and run all tests**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm build && pnpm test
```

Expected: all existing tests pass (106+).

- [ ] **Step 3: Commit**

```bash
git add worker/src/stages/classify.ts
git commit -m "fix: idempotency check uses classification_method; adopt DocumentType + ExtractedRefs"
```

---

### Task 5: Fan-in Barrier

**Files:**
- Create: `worker/src/stages/fan-in.ts`
- Create: `__tests__/worker/fan-in.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/worker/fan-in.test.ts
import { describe, it, expect } from 'vitest';
import { shouldEnqueuePhase2 } from '../../worker/src/stages/fan-in';

describe('shouldEnqueuePhase2', () => {
  it('returns true when count equals sibling_count and freight invoice is known', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(true);
  });

  it('returns false when count is less than sibling_count', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 2, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(false);
  });

  it('returns false when freight_invoice_document_id is null', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: null, phase2_enqueued: false,
    })).toBe(false);
  });

  it('returns false when phase2 already enqueued', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: true,
    })).toBe(false);
  });

  it('returns true when count exceeds sibling_count (last worker won the race)', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm test __tests__/worker/fan-in.test.ts
```

Expected: FAIL — `shouldEnqueuePhase2` not found.

- [ ] **Step 3: Create fan-in.ts**

```typescript
// worker/src/stages/fan-in.ts
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
  const { data: batch } = await supabase.rpc('increment_batch_phase1', {
    p_org_id: orgId,
    p_source_message_id: sourceMessageId,
    p_freight_invoice_doc_id: isFreightInvoice ? documentId : null,
  });

  const row: BatchRow | null = Array.isArray(batch) ? batch[0] ?? null : (batch as BatchRow | null);
  if (!row || !shouldEnqueuePhase2(row)) return;

  const { data: claimed } = await supabase.rpc('claim_phase2_enqueue', {
    p_org_id: orgId,
    p_source_message_id: sourceMessageId,
  });

  if (!claimed) return;

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
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
pnpm test __tests__/worker/fan-in.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/stages/fan-in.ts __tests__/worker/fan-in.test.ts
git commit -m "feat: fan-in barrier — atomic phase1 counter + claim_phase2_enqueue"
```

---

### Task 6: Phase 1 Job Handler

**Files:**
- Create: `worker/src/jobs/phase1.ts`

- [ ] **Step 1: Create phase1.ts**

```typescript
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
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all passing (no regressions).

- [ ] **Step 3: Commit**

```bash
git add worker/src/jobs/phase1.ts
git commit -m "feat: Phase 1 job handler — OCR + classify + fan-in + re-audit trigger"
```

---

### Task 7: Link Documents Stage

**Files:**
- Create: `worker/src/stages/link-documents.ts`
- Create: `__tests__/worker/link-documents.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/worker/link-documents.test.ts
import { describe, it, expect } from 'vitest';
import { mergeCandidatesByDocumentId, refsOverlap } from '../../worker/src/stages/link-documents';

const makeDoc = (id: string) => ({
  documentId: id, documentType: 'BOL', filename: `${id}.pdf`,
  extractedRefs: null, sourceThreadId: null,
});

describe('mergeCandidatesByDocumentId', () => {
  it('deduplicates a doc appearing in two groups', () => {
    const result = mergeCandidatesByDocumentId([
      [makeDoc('doc-1')],
      [makeDoc('doc-1'), makeDoc('doc-2')],
    ]);
    expect(result).toHaveLength(2);
    expect(result.map(d => d.documentId).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('returns empty when all groups are empty', () => {
    expect(mergeCandidatesByDocumentId([[], []])).toHaveLength(0);
  });

  it('preserves first occurrence when same doc in multiple groups', () => {
    const doc1a = { ...makeDoc('doc-1'), documentType: 'BOL' };
    const doc1b = { ...makeDoc('doc-1'), documentType: 'RATE_SHEET' };
    const result = mergeCandidatesByDocumentId([[doc1a], [doc1b]]);
    expect(result[0].documentType).toBe('BOL');
  });
});

describe('refsOverlap', () => {
  const base = { invoiceNumbers: [], bolNumbers: [], proNumbers: [], poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null };

  it('returns true when invoice numbers overlap', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['INV-001'] },
      { ...base, invoiceNumbers: ['INV-001', 'INV-002'] }
    )).toBe(true);
  });

  it('returns true when BOL number in one matches invoice number in the other', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['BOL-999'] },
      { ...base, bolNumbers: ['BOL-999'] }
    )).toBe(true);
  });

  it('returns false when no overlap', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['INV-001'] },
      { ...base, invoiceNumbers: ['INV-999'] }
    )).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['inv-001'] },
      { ...base, invoiceNumbers: ['INV-001'] }
    )).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm test __tests__/worker/link-documents.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create link-documents.ts**

```typescript
// worker/src/stages/link-documents.ts
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedRefs } from '@sifter/core/llm/classify-invoice';

export interface CandidateDoc {
  documentId: string;
  documentType: string;
  filename: string;
  extractedRefs: ExtractedRefs | null;
  sourceThreadId: string | null;
}

interface LinkSuggestion {
  documentId: string;
  refType: 'BOL' | 'RATE_SHEET' | 'LUMPER_RECEIPT' | 'DETENTION_NOTICE' | 'OTHER';
  linkConfidence: number;
  reasoning: string;
}

export function mergeCandidatesByDocumentId(groups: CandidateDoc[][]): CandidateDoc[] {
  const seen = new Map<string, CandidateDoc>();
  for (const group of groups) {
    for (const doc of group) {
      if (!seen.has(doc.documentId)) seen.set(doc.documentId, doc);
    }
  }
  return Array.from(seen.values());
}

export function refsOverlap(a: ExtractedRefs, b: ExtractedRefs): boolean {
  const flatten = (r: ExtractedRefs) =>
    [...r.invoiceNumbers, ...r.bolNumbers, ...r.proNumbers, ...r.poNumbers, ...r.trackingNumbers]
      .map(s => s.toLowerCase())
      .filter(Boolean);
  const setA = new Set(flatten(a));
  return flatten(b).some(v => setA.has(v));
}

const LINKING_PROMPT = `You are a document linking agent for freight invoice auditing.
Given a freight invoice and a list of candidate supporting documents, determine which are related to this specific invoice.
Return JSON: { "links": Array<{ documentId: string, refType: "BOL"|"RATE_SHEET"|"LUMPER_RECEIPT"|"DETENTION_NOTICE"|"OTHER", linkConfidence: number, reasoning: string }> }
Include any candidate with linkConfidence >= 0.3. The audit agent handles final relevance — prefer false positives over misses.`;

type SupabaseDocRow = {
  id: string;
  document_type: string;
  filename: string;
  extracted_refs: ExtractedRefs | null;
  source_thread_id: string | null;
};

export async function runLinkDocumentsStage(
  supabase: SupabaseClient,
  {
    orgId,
    invoiceId,
    invoiceDocumentId,
    invoiceExtractedRefs,
    invoiceCarrierId,
    invoiceDate,
    sourceThreadId,
  }: {
    orgId: string;
    invoiceId: string;
    invoiceDocumentId: string;
    invoiceExtractedRefs: ExtractedRefs;
    invoiceCarrierId: string | null;
    invoiceDate: string | null;
    sourceThreadId: string | null;
  }
): Promise<void> {
  const toCandidate = (d: SupabaseDocRow): CandidateDoc => ({
    documentId: d.id,
    documentType: d.document_type,
    filename: d.filename,
    extractedRefs: d.extracted_refs,
    sourceThreadId: d.source_thread_id,
  });

  // Group 1: same thread
  let group1: CandidateDoc[] = [];
  if (sourceThreadId) {
    const { data } = await supabase
      .from('documents')
      .select('id, document_type, filename, extracted_refs, source_thread_id')
      .eq('org_id', orgId)
      .eq('source_thread_id', sourceThreadId)
      .neq('id', invoiceDocumentId)
      .neq('document_type', 'OTHER');
    group1 = (data ?? []).map(toCandidate);
  }

  // Group 2: ref cross-match (last 90 days)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentDocs } = await supabase
    .from('documents')
    .select('id, document_type, filename, extracted_refs, source_thread_id')
    .eq('org_id', orgId)
    .neq('id', invoiceDocumentId)
    .neq('document_type', 'OTHER')
    .not('extracted_refs', 'is', null)
    .gte('created_at', cutoff);
  const group2: CandidateDoc[] = (recentDocs ?? [])
    .filter((d: SupabaseDocRow) => d.extracted_refs && refsOverlap(invoiceExtractedRefs, d.extracted_refs))
    .map(toCandidate);

  // Group 3: carrier + date window (±7 days)
  let group3: CandidateDoc[] = [];
  if (invoiceCarrierId && invoiceDate && invoiceExtractedRefs.carrierName) {
    const base = new Date(invoiceDate);
    const min = new Date(base); min.setDate(min.getDate() - 7);
    const max = new Date(base); max.setDate(max.getDate() + 7);
    const carrierLower = invoiceExtractedRefs.carrierName.toLowerCase();

    const { data: carrierDocs } = await supabase
      .from('documents')
      .select('id, document_type, filename, extracted_refs, source_thread_id')
      .eq('org_id', orgId)
      .neq('id', invoiceDocumentId)
      .neq('document_type', 'OTHER')
      .not('extracted_refs', 'is', null)
      .gte('created_at', cutoff);

    group3 = (carrierDocs ?? [])
      .filter((d: SupabaseDocRow) => {
        const refs = d.extracted_refs;
        if (!refs?.shipmentDate || !refs.carrierName) return false;
        const shipDate = new Date(refs.shipmentDate);
        return (
          refs.carrierName.toLowerCase().includes(carrierLower) &&
          shipDate >= min && shipDate <= max
        );
      })
      .map(toCandidate);
  }

  const candidates = mergeCandidatesByDocumentId([group1, group2, group3]);
  if (candidates.length === 0) return;

  // Call linking agent
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const contextJson = JSON.stringify({
    invoice: { invoiceDate, extractedRefs: invoiceExtractedRefs },
    candidates,
  });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `${LINKING_PROMPT}\n\nCONTEXT:\n${contextJson.slice(0, 80_000)}` }],
  });
  const raw = res.choices[0]?.message?.content ?? '{"links":[]}';
  const { links } = JSON.parse(raw) as { links: LinkSuggestion[] };
  if (!links.length) return;

  // Delete old ai-linked refs, insert fresh ones
  await supabase
    .from('invoice_references')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .eq('link_method', 'ai')
    .not('related_document_id', 'is', null);

  const rows = links
    .filter(l => l.linkConfidence >= 0.3)
    .map(l => {
      const candidate = candidates.find(c => c.documentId === l.documentId);
      return {
        org_id: orgId,
        invoice_id: invoiceId,
        ref_type: l.refType,
        ref_value: candidate?.filename ?? l.documentId,
        related_document_id: l.documentId,
        link_confidence: l.linkConfidence,
        link_method: 'ai',
      };
    });

  if (rows.length > 0) {
    await supabase.from('invoice_references').insert(rows);
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**

```bash
pnpm test __tests__/worker/link-documents.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/stages/link-documents.ts __tests__/worker/link-documents.test.ts
git commit -m "feat: linking agent — 3 candidate groups, dedup by doc ID, write invoice_references"
```

---

### Task 8: Pre-gather Context Stage

**Files:**
- Create: `worker/src/stages/pre-gather.ts`

- [ ] **Step 1: Create pre-gather.ts**

```typescript
// worker/src/stages/pre-gather.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';

export interface PreGatheredContext {
  invoiceRawText: string;
  rateSheetText: string | null;
  bolTexts: string[];
}

const RATE_SHEET_MAX = 40_000;
const BOL_MAX = 20_000;

async function fetchMongoText(db: Db, mongoDocId: string | null | undefined): Promise<string> {
  if (!mongoDocId) return '';
  const doc = await db.collection('document_ocr').findOne({
    _id: mongoDocId as unknown as import('mongodb').ObjectId,
  });
  return (doc?.rawText as string) ?? '';
}

export async function runPreGatherStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, invoiceId, invoiceDocumentId }: { orgId: string; invoiceId: string; invoiceDocumentId: string }
): Promise<PreGatheredContext> {
  // Invoice OCR text
  const { data: invDoc } = await supabase
    .from('documents')
    .select('mongodb_document_id')
    .eq('id', invoiceDocumentId)
    .eq('org_id', orgId)
    .single();
  const invoiceRawText = await fetchMongoText(db, invDoc?.mongodb_document_id);

  // Linked docs from invoice_references (written by linking stage)
  const { data: refs } = await supabase
    .from('invoice_references')
    .select('related_document_id, ref_type')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .not('related_document_id', 'is', null);

  const bolTexts: string[] = [];
  let rateSheetText: string | null = null;

  if (refs?.length) {
    const linkedIds = refs.map((r: { related_document_id: string }) => r.related_document_id);
    const { data: linkedDocs } = await supabase
      .from('documents')
      .select('id, document_type, mongodb_document_id')
      .eq('org_id', orgId)
      .in('id', linkedIds);

    for (const doc of linkedDocs ?? []) {
      const text = await fetchMongoText(db, doc.mongodb_document_id);
      if (doc.document_type === 'BOL') {
        bolTexts.push(text.slice(0, BOL_MAX));
      } else if (doc.document_type === 'RATE_SHEET' && rateSheetText === null) {
        rateSheetText = text.slice(0, RATE_SHEET_MAX);
      }
    }
  }

  // Fallback: rate sheet from rate_sheets table (for carrier-page uploads)
  if (rateSheetText === null) {
    rateSheetText = await fetchRateSheetFallback(supabase, db, orgId, invoiceId);
  }

  return { invoiceRawText, rateSheetText, bolTexts };
}

async function fetchRateSheetFallback(
  supabase: SupabaseClient,
  db: Db,
  orgId: string,
  invoiceId: string
): Promise<string | null> {
  const { data: inv } = await supabase
    .from('invoices')
    .select('carrier_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (!inv?.carrier_id) return null;

  const { data: sheets } = await supabase
    .from('rate_sheets')
    .select('document_id')
    .eq('org_id', orgId)
    .eq('carrier_id', inv.carrier_id)
    .eq('status', 'current')
    .limit(1);
  if (!sheets?.length) return null;

  const { data: rsDoc } = await supabase
    .from('documents')
    .select('mongodb_document_id')
    .eq('id', sheets[0].document_id)
    .single();

  const text = await fetchMongoText(db, rsDoc?.mongodb_document_id);
  return text ? text.slice(0, RATE_SHEET_MAX) : null;
}
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add worker/src/stages/pre-gather.ts
git commit -m "feat: pre-gather stage fetches invoice+BOL+rate sheet OCR text from MongoDB"
```

---

### Task 9: Update AI Audit Agent

**Files:**
- Modify: `packages/core/src/audit/ai-audit-agent.ts`

- [ ] **Step 1: Replace ai-audit-agent.ts**

```typescript
// packages/core/src/audit/ai-audit-agent.ts
import OpenAI from 'openai';
import type { FindingDraft } from './types.js';

export const AI_AUDIT_PROMPT = `You are a freight invoice auditor. Given context with:
- invoiceJson: normalized invoice fields (carrier, invoice number, date, total, line items)
- invoiceRawText: raw OCR text from the invoice PDF
- rateSheetText: raw OCR text from the contracted rate sheet (if available)
- bolTexts: array of raw OCR texts from Bills of Lading (if available)

Return JSON { "findings": FindingDraft[] } where each finding has:
finding_type in [rate_mismatch, fuel_surcharge, detention, accessorial_without_proof, bol_mismatch, lumper_without_receipt]
rule_id: unique string per finding
source: always "ai_audit"
severity: low|medium|high
expected_amount, charged_amount (nullable), delta_amount (positive = overcharge)
summary: one sentence for AP
reasoning: short justification
confidence: 0-1
evidence_json: page references or snippet ids

Checks to perform:
1) Rate mismatch: compare invoice line item amounts against rates in rateSheetText
2) BOL mismatch: check weight, lanes, dates between bolTexts and invoiceRawText
3) Fuel surcharge: verify percentage vs linehaul in invoiceRawText
4) Detention without appointment evidence in supporting docs
5) Lumper without receipt when charged on invoice
6) Accessorial without proof document

If no issues, return findings: []. Do not duplicate rule_ids already present in deterministic_findings.`;

export async function runAiAuditAgent(context: {
  invoiceJson: unknown;
  invoiceRawText?: string;
  rateSheetText?: string;
  bolTexts?: string[];
  deterministicFindings: { rule_id: string }[];
}): Promise<FindingDraft[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `${AI_AUDIT_PROMPT}\n\nCONTEXT:\n${JSON.stringify(context).slice(0, 100_000)}`,
    }],
  });
  const raw = res.choices[0]?.message?.content ?? '{"findings":[]}';
  const parsed = JSON.parse(raw) as { findings: FindingDraft[] };
  return mergeDedupByRule(context.deterministicFindings as FindingDraft[], parsed.findings);
}

export function mergeDedupByRule(
  deterministic: { rule_id: string }[],
  ai: FindingDraft[]
): FindingDraft[] {
  const ruleIds = new Set(deterministic.map((d) => d.rule_id));
  return [...(deterministic as FindingDraft[]), ...ai.filter((a) => !ruleIds.has(a.rule_id))];
}
```

- [ ] **Step 2: Build core**

```bash
cd packages/core && pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/audit/ai-audit-agent.ts
git commit -m "feat: audit agent accepts invoiceRawText, rateSheetText, bolTexts for full context"
```

---

### Task 10: Update Post-audit Stage + Phase 2 Job Handler

**Files:**
- Modify: `worker/src/stages/post-audit.ts`
- Create: `worker/src/jobs/phase2.ts`

- [ ] **Step 1: Replace post-audit.ts**

```typescript
// worker/src/stages/post-audit.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicChecks } from '@sifter/core/audit/deterministic-checks';
import { runAiAuditAgent } from '@sifter/core/audit/ai-audit-agent';
import { insertFindingsAndUpdateInvoice } from '@sifter/core/audit/post-audit-db';
import type { FindingDraft } from '@sifter/core/audit/types';
import type { CheckResult } from '@sifter/core/audit/deterministic-checks';
import type { PreGatheredContext } from './pre-gather.js';

interface PostAuditInput {
  orgId: string;
  invoiceId: string;
  preGatheredContext: PreGatheredContext;
}

/**
 * Idempotent: skips if findings already exist for this invoiceId.
 * For re-audit, caller deletes findings first.
 */
export async function runPostAuditStage(
  supabase: SupabaseClient,
  { orgId, invoiceId, preGatheredContext }: PostAuditInput
): Promise<void> {
  const { data: existingFindings } = await supabase
    .from('findings').select('id').eq('invoice_id', invoiceId).eq('org_id', orgId).limit(1);
  if (existingFindings && existingFindings.length > 0) return;

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, carrier_id, invoice_number, invoice_date, total_amount, created_at')
    .eq('id', invoiceId).eq('org_id', orgId).single();
  if (invErr) throw new Error(`Failed to load invoice: ${invErr.message}`);

  const { data: items } = await supabase
    .from('invoice_line_items').select('amount, description')
    .eq('invoice_id', invoiceId).eq('org_id', orgId);

  const lineItems = items ?? [];
  const lineSum = lineItems.reduce((s: number, i: { amount: number }) => s + (i.amount ?? 0), 0);
  const lineDescriptions = lineItems.map((i: { description: string }) => i.description ?? '');

  const deterministicResults = runDeterministicChecks({
    lineSum,
    totalAmount: inv.total_amount,
    invoiceDate: new Date(inv.invoice_date),
    receivedAt: new Date(inv.created_at),
    lineDescriptions,
    hasExistingClearedDuplicate: false,
    duplicateDelta: 0,
  });

  const detFindings = deterministicResults
    .filter((r: CheckResult) => r.triggered)
    .map((r: CheckResult): FindingDraft => ({
      finding_type: r.finding_type,
      rule_id: r.rule_id,
      source: 'deterministic',
      severity: 'medium',
      delta_amount: r.delta_amount,
      summary: r.description,
      reasoning: r.description,
    }));

  const findings = await runAiAuditAgent({
    invoiceJson: { ...inv, lineItems },
    invoiceRawText: preGatheredContext.invoiceRawText,
    rateSheetText: preGatheredContext.rateSheetText ?? undefined,
    bolTexts: preGatheredContext.bolTexts.length > 0 ? preGatheredContext.bolTexts : undefined,
    deterministicFindings: detFindings,
  });

  await insertFindingsAndUpdateInvoice(supabase, orgId, invoiceId, findings);
}
```

- [ ] **Step 2: Create phase2.ts**

```typescript
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
  const { data: docRow } = await supabase
    .from('documents').select('mongodb_document_id, source_thread_id, extracted_refs')
    .eq('id', documentId).eq('org_id', orgId).single();

  const mongoDocId = docRow?.mongodb_document_id ?? '';
  const invoiceId = await runNormalizeStage(supabase, db, { orgId, documentId, mongoDocId });

  // Load carrier and date for linking
  const { data: inv } = await supabase
    .from('invoices').select('carrier_id, invoice_date')
    .eq('id', invoiceId).eq('org_id', orgId).single();

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

  await supabase
    .from('documents')
    .update({ processing_status: 'audited', updated_at: new Date().toISOString() })
    .eq('id', documentId).eq('org_id', orgId);
}
```

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add worker/src/stages/post-audit.ts worker/src/jobs/phase2.ts
git commit -m "feat: Phase 2 job — normalize + link + pre-gather + audit; post-audit accepts PreGatheredContext"
```

---

### Task 11: Update gmail-sync

**Files:**
- Modify: `worker/src/jobs/gmail-sync.ts`

- [ ] **Step 1: Update imports at top of gmail-sync.ts**

Replace the queue import line:

```typescript
import { phase1Queue, emailEventsQueue } from '@sifter/core/queue/index';
import type { Phase1Payload } from '@sifter/core/queue/types';
```

- [ ] **Step 2: Rewrite processMessage to write the batch row and use phase1Queue**

Replace the `processMessage` function (lines 37–144 in current file):

```typescript
async function processMessage(
  gmail: Awaited<ReturnType<typeof buildGmailClient>>,
  orgId: string,
  messageId: string,
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<void> {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const headers = msg.data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find(
      (h: { name?: string | null; value?: string | null }) =>
        h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? '';

  const threadId = msg.data.threadId ?? messageId;
  const fromEmail = getHeader('from');
  const toEmails = getHeader('to').split(',').map((s: string) => s.trim()).filter(Boolean);
  const ccEmails = getHeader('cc').split(',').map((s: string) => s.trim()).filter(Boolean);
  const subject = getHeader('subject');
  const dateStr = getHeader('date');
  const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
  const body = extractBody(msg.data.payload);

  await emailEventsQueue.add(
    `email-${messageId}`,
    { orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt },
    { jobId: `email-${messageId}` }
  );

  const attachments = findPdfAttachments(msg.data.payload);
  if (attachments.length === 0) return;

  // Write fan-in batch BEFORE processing any attachments
  await supabase.from('email_message_batches').upsert({
    org_id: orgId,
    source_message_id: messageId,
    source_thread_id: threadId,
    sibling_count: attachments.length,
  }, { onConflict: 'org_id,source_message_id', ignoreDuplicates: true });

  const storage = getStorage();
  const bucket = storage.bucket(process.env.GCS_BUCKET!);

  for (const att of attachments) {
    if (!att.body?.attachmentId) continue;

    const attData = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: att.body.attachmentId,
    });

    const buf = Buffer.from(attData.data.data ?? '', 'base64url');
    const sha256 = createHash('sha256').update(buf).digest('hex');

    const { data: existing } = await supabase
      .from('documents').select('id').eq('org_id', orgId).eq('sha256', sha256).maybeSingle();
    if (existing) {
      // Duplicate attachment — still counts toward sibling_count; increment fan-in manually
      await supabase.rpc('increment_batch_phase1', {
        p_org_id: orgId,
        p_source_message_id: messageId,
        p_freight_invoice_doc_id: null,
      });
      continue;
    }

    const filename = att.filename || `attachment-${att.body.attachmentId}.pdf`;
    const gcsKey = `orgs/${orgId}/emails/${messageId}/${filename}`;
    await bucket.file(gcsKey).save(buf, { contentType: 'application/pdf' });

    const { data: doc } = await supabase
      .from('documents')
      .insert({
        org_id: orgId,
        source_type: 'email',
        source_message_id: messageId,
        source_thread_id: threadId,
        filename,
        mime_type: 'application/pdf',
        file_size_bytes: buf.length,
        gcs_key: gcsKey,
        sha256,
        processing_status: 'pending',
      })
      .select('id')
      .single();

    if (!doc) continue;

    await phase1Queue.add(
      `phase1-${doc.id}`,
      {
        orgId,
        documentId: doc.id,
        gcsKey,
        sourceType: 'email',
        sourceMessageId: messageId,
        sourceThreadId: threadId,
      } satisfies Phase1Payload,
      { jobId: `phase1-${doc.id}` }
    );
  }
}
```

> **Note on duplicate attachments:** When a PDF with an existing sha256 is skipped, it still occupies a slot in `sibling_count`. The manual `increment_batch_phase1` call above keeps the counter accurate so the batch can still close.

- [ ] **Step 3: Build and run tests**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm build && pnpm test
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add worker/src/jobs/gmail-sync.ts
git commit -m "feat: gmail-sync writes email_message_batches and enqueues to phase1Queue"
```

---

### Task 12: Update Upload Route

**Files:**
- Modify: `app/api/documents/upload/route.ts`

- [ ] **Step 1: Update the import and queue call**

Replace:
```typescript
import { documentPipelineQueue } from '@sifter/core/queue/index';
```
With:
```typescript
import { phase1Queue } from '@sifter/core/queue/index';
```

Replace the `documentPipelineQueue.add` call:
```typescript
await phase1Queue.add(
  `phase1-${id}`,
  { orgId: ctx.orgId, documentId: id, gcsKey, sourceType: 'upload' },
  { jobId: `phase1-${id}` }
);
```

- [ ] **Step 2: Build Next.js**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm build
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/upload/route.ts
git commit -m "feat: upload route enqueues to phase1Queue"
```

---

### Task 13: Update Worker Entry and Bull Board

**Files:**
- Modify: `worker/src/workers.ts`
- Modify: `worker/src/board.ts`

- [ ] **Step 1: Replace workers.ts**

```typescript
// worker/src/workers.ts
import { Worker } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { getMongoDb } from '@sifter/core/mongodb/client';
import { getRedisConnection } from '@sifter/core/queue/index';
import { handlePhase1 } from './jobs/phase1.js';
import { handlePhase2 } from './jobs/phase2.js';
import { handleGmailSync } from './jobs/gmail-sync.js';
import { handleEmailEvents } from './jobs/email-events.js';

export function createWorkers(): Worker[] {
  const connection = getRedisConnection();

  const phase1Worker = new Worker(
    'phase1',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handlePhase1(job, supabase, db);
    },
    { connection, concurrency: 5, lockDuration: 300_000 }
  );

  const phase2Worker = new Worker(
    'phase2',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handlePhase2(job, supabase, db);
    },
    { connection, concurrency: 2, lockDuration: 600_000 }
  );

  const gmailWorker = new Worker(
    'gmail-sync',
    async () => { await handleGmailSync(); },
    { connection, concurrency: 1 }
  );

  const emailWorker = new Worker(
    'email-events',
    async (job) => { await handleEmailEvents(job); },
    { connection, concurrency: 5 }
  );

  const pairs = [
    { worker: phase1Worker, label: 'phase1' },
    { worker: phase2Worker, label: 'phase2' },
    { worker: gmailWorker, label: 'gmail-sync' },
    { worker: emailWorker, label: 'email-events' },
  ];

  for (const { worker, label } of pairs) {
    worker.on('failed', (job, err) => {
      console.error(`[${label}] Job ${job?.id} failed:`, err.message);
    });
  }

  return [phase1Worker, phase2Worker, gmailWorker, emailWorker];
}
```

- [ ] **Step 2: Replace board.ts**

```typescript
// worker/src/board.ts
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { phase1Queue, phase2Queue, gmailSyncQueue, emailEventsQueue } from '@sifter/core/queue/index';

export function startBullBoard(): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');

  createBullBoard({
    queues: [
      new BullMQAdapter(phase1Queue),
      new BullMQAdapter(phase2Queue),
      new BullMQAdapter(gmailSyncQueue),
      new BullMQAdapter(emailEventsQueue),
    ],
    serverAdapter,
  });

  const app = express();
  app.use('/', serverAdapter.getRouter());
  app.listen(9999, () => {
    console.log('[board] Bull Board running on :9999 (internal only — use fly proxy 9999)');
  });
}
```

- [ ] **Step 3: Build worker and run all tests**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm build && pnpm test
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add worker/src/workers.ts worker/src/board.ts
git commit -m "feat: register phase1Worker + phase2Worker; update Bull Board queues"
```

---

### Task 14: Remove Old document-pipeline

**Files:**
- Delete: `worker/src/jobs/document-pipeline.ts`
- Delete: `worker/src/stages/gather-context.ts`
- Modify: `packages/core/src/queue/types.ts` — remove `DocumentPipelinePayload`
- Modify: `packages/core/src/queue/index.ts` — remove `documentPipelineQueue`
- Modify: `packages/core/src/index.ts` — no action needed (re-exports via `queue/types.ts` and `queue/index.ts` already updated)

- [ ] **Step 1: Delete old files**

```bash
rm worker/src/jobs/document-pipeline.ts
rm worker/src/stages/gather-context.ts
```

- [ ] **Step 2: Remove DocumentPipelinePayload from types.ts**

Remove the `DocumentPipelinePayload` interface (it is no longer used anywhere).

Final `packages/core/src/queue/types.ts` should only contain `Phase1Payload`, `Phase2Payload`, `GmailSyncPayload`, `EmailEventsPayload`.

- [ ] **Step 3: Remove documentPipelineQueue from index.ts**

Remove the `documentPipelineQueue` export and the `DocumentPipelinePayload` import from `packages/core/src/queue/index.ts`.

- [ ] **Step 4: Build and run all tests**

```bash
cd /Users/vanhtran18/Documents/Sifter/sifter-recode && pnpm build && pnpm test
```

Expected: all tests pass. Confirm no imports of `documentPipelineQueue` or `DocumentPipelinePayload` remain:

```bash
grep -r "documentPipelineQueue\|DocumentPipelinePayload\|document-pipeline" --include="*.ts" .
```

Expected: no matches (except possibly in git history or comments).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove document-pipeline queue, gather-context stage; two-phase migration complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Two BullMQ queues (`phase1`, `phase2`) replace `document-pipeline`
- ✅ Classification bug fixed (idempotency check uses `classification_method`)
- ✅ New `DocumentType` enum with all 6 types
- ✅ `ExtractedRefs` extracted in same LLM call as classify
- ✅ `email_message_batches` fan-in barrier with atomic RPCs
- ✅ Manual uploads bypass fan-in, go direct to phase2Queue
- ✅ Re-audit trigger: only fires when `source_message_id` differs (follow-up thread message)
- ✅ Phase 2: normalize → link → pre-gather → audit
- ✅ Linking: 3 groups (thread, ref cross-match, carrier+date), deduped by doc ID
- ✅ Linking agent is LLM-based; no heuristic code filters
- ✅ Duplicate attachment in same message handled (manual fan-in increment)
- ✅ Pre-gather: invoice raw text + BOL texts + rate sheet text (fallback to rate_sheets table)
- ✅ Audit agent receives invoiceRawText, rateSheetText, bolTexts
- ✅ Re-audit clears findings before Phase 2; uses `removeOnComplete` jobId dedup
- ✅ DB: `email_message_batches`, `extracted_refs`, `document_type` constraint, `re_auditing` status
- ✅ `invoice_references` ai-linked rows deleted and re-inserted on re-audit

**Known limitation (post-MVP):** If a re-audit job is actively running when a second supporting doc triggers another re-audit, BullMQ deduplication (`jobId: phase2-reaudit-${invoiceDocId}` with `removeOnComplete`) means the second trigger is a no-op until the first completes. In practice, the next natural trigger (another doc or manual re-run) will pick it up.
