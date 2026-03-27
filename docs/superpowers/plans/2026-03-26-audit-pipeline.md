# Audit Pipeline (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end automated ingestion, OCR, classification, LLM normalization, deterministic + AI auditing, and email/manual intake so invoices move from raw documents to `findings` + correct `invoices.ui_status` in Supabase.

**Architecture:** Inngest orchestrates a durable event chain (`sifter/document.received` → OCR → classify → normalize → gather context → deterministic checks → AI audit → post-audit). Raw PDFs live in GCS; OCR and extraction intermediates go to MongoDB; structured truth stays in Postgres via a **service-role** Supabase client inside workers (no user cookies). Business logic that is not Inngest-specific lives in pure modules under `lib/audit/` and `lib/invoices/` so Vitest can cover it without running the Inngest dev server.

**Tech Stack:** Next.js 16 (App Router), Inngest 4.x, Supabase JS (service role for jobs), `@google-cloud/storage`, `mongodb` (add to app workspace — already present in `worker/`), OpenAI SDK 6.x (`openai`), `googleapis` (Gmail), Vitest 4.x, pnpm.

---

## File map (create / modify)

| Path | Role |
|------|------|
| `lib/supabase/service-role.ts` | `createServiceRoleClient()` for Inngest + background jobs |
| `lib/mongodb/client.ts` | Lazy Mongo client for OCR blobs |
| `lib/inngest/types.ts` | Extend `SifterEvents` for pipeline events |
| `lib/inngest/functions/*.ts` | One file per Inngest function |
| `lib/inngest/functions/index.ts` | Export `inngestFunctions` array |
| `app/api/inngest/route.ts` | `serve({ functions: inngestFunctions })` |
| `lib/ocr/extract-text.ts` | PDF → text (wrapper over pdf-parse or vision fallback) |
| `lib/invoices/normalize-schema.ts` | Zod / types for LLM normalization output |
| `lib/audit/deterministic-checks.ts` | Pure check functions + `runDeterministicChecks` |
| `lib/audit/ai-audit-agent.ts` | OpenAI calls returning `FindingDraft[]` |
| `lib/audit/types.ts` | Shared finding draft types |
| `lib/inngest/lib/post-audit-db.ts` | Inserts findings, updates invoice (testable) |
| `lib/email/gmail-poller.ts` | Gmail history sync helpers |
| `app/api/documents/upload/route.ts` | Multipart upload → GCS + DB + event |

**Schema alignment:** Use `documents.processing_status` (`pending` \| `processing` \| `completed` \| `failed`), not a `classification_status` column. Use `documents.gcs_key` (not `gcs_path`). Gate failures set `processing_status = 'failed'` and stop the chain.

**Event naming:** Prefer extending existing `sifter/document.received` as the intake event (already in `lib/inngest/types.ts`). Add new events: `sifter/document.ocr.complete`, `sifter/document.ready_to_normalize` (after classify pass), `sifter/invoice.context_ready`, `sifter/invoice.audit_requested` — or chain fewer events with Inngest `step.invoke` / sequential functions; the tasks below use explicit events for clarity and replay.

---

### Task 1: Service-role Supabase + Inngest function registry

**Files:**
- Create: `lib/supabase/service-role.ts`
- Create: `lib/inngest/functions/index.ts`
- Modify: `app/api/inngest/route.ts`
- Modify: `lib/inngest/types.ts`
- Test: `__tests__/supabase/service-role.test.ts`
- Test: `__tests__/inngest/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/supabase/service-role.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('createServiceRoleClient', () => {
  const OLD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  });

  it('throws if service role key missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(import('@/lib/supabase/service-role')).rejects.toThrow();
  });
});
```

```typescript
// __tests__/inngest/registry.test.ts
import { describe, it, expect } from 'vitest';

describe('inngest function registry', () => {
  it('exports a non-empty functions array', async () => {
    const { inngestFunctions } = await import('@/lib/inngest/functions');
    expect(Array.isArray(inngestFunctions)).toBe(true);
    expect(inngestFunctions.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/supabase/service-role.test.ts __tests__/inngest/registry.test.ts`
Expected: FAIL — module not found / `inngestFunctions` undefined / empty array / throw path wrong (adjust assertion to match first failure).

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/supabase/service-role.ts
import { createClient } from '@supabase/supabase-js';

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

```typescript
// lib/inngest/functions/index.ts
import { inngest } from '@/lib/inngest/client';

/**
 * Placeholder no-op function so the registry is non-empty before later tasks
 * replace it with real pipeline functions.
 */
const placeholder = inngest.createFunction(
  { id: 'pipeline-placeholder', name: 'Pipeline Placeholder' },
  { event: 'sifter/pipeline.health' },
  async () => ({ ok: true })
);

export const inngestFunctions = [placeholder];
```

```typescript
// app/api/inngest/route.ts — replace functions: [] with:
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { inngestFunctions } from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
```

Add to `lib/inngest/types.ts`:

```typescript
  'sifter/pipeline.health': { data: Record<string, never> };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/supabase/service-role.test.ts __tests__/inngest/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/service-role.ts lib/inngest/functions/index.ts app/api/inngest/route.ts lib/inngest/types.ts __tests__/supabase/service-role.test.ts __tests__/inngest/registry.test.ts
git commit -m "feat(inngest): service-role client and non-empty function registry"
```

---

### Task 2: Document ingestion — download GCS, OCR, MongoDB, emit next event

**Files:**
- Create: `lib/ocr/extract-text.ts`
- Create: `lib/mongodb/client.ts`
- Create: `lib/inngest/functions/ingest-document.ts`
- Modify: `lib/inngest/functions/index.ts` (register function; remove placeholder when wired)
- Modify: `lib/inngest/types.ts`
- Test: `__tests__/ocr/extract-text.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/ocr/extract-text.test.ts
import { describe, it, expect } from 'vitest';
import { extractTextFromPdfBuffer } from '@/lib/ocr/extract-text';

describe('extractTextFromPdfBuffer', () => {
  it('returns empty string for empty buffer', async () => {
    await expect(extractTextFromPdfBuffer(Buffer.alloc(0))).resolves.toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/ocr/extract-text.test.ts`
Expected: FAIL — cannot find module `@/lib/ocr/extract-text`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/ocr/extract-text.ts
/**
 * PDF text extraction. Prefer pdf-parse (add dependency) or pdfjs-dist.
 * If text layer is empty, optionally call OpenAI vision in a later iteration.
 */
export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  if (!buf.length) return '';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return (text ?? '').trim();
}
```

Add `pdf-parse` and `@types/pdf-parse`: `pnpm add pdf-parse && pnpm add -D @types/pdf-parse`

```typescript
// lib/mongodb/client.ts
import { MongoClient } from 'mongodb';

let client: MongoClient | null = null;

export async function getMongoDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB_NAME ?? 'sifter');
}
```

`pnpm add mongodb` at repo root.

```typescript
// lib/inngest/functions/ingest-document.ts
import { Storage } from '@google-cloud/storage';
import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { extractTextFromPdfBuffer } from '@/lib/ocr/extract-text';
import { getMongoDb } from '@/lib/mongodb/client';
import { randomUUID } from 'crypto';

export const ingestDocument = inngest.createFunction(
  { id: 'ingest-document', name: 'Ingest Document (OCR)' },
  { event: 'sifter/document.received' },
  async ({ event, step }) => {
    const { orgId, documentId, gcsKey } = event.data;
    const supabase = createServiceRoleClient();

    const text = await step.run('download-and-ocr', async () => {
      const storage = new Storage();
      const [buf] = await storage.bucket(process.env.GCS_BUCKET!).file(gcsKey).download();
      return extractTextFromPdfBuffer(buf);
    });

    const mongoId = await step.run('persist-ocr-text', async () => {
      const db = await getMongoDb();
      const id = randomUUID();
      await db.collection('document_ocr').insertOne({
        _id: id,
        orgId,
        documentId,
        rawText: text,
        createdAt: new Date(),
      });
      return id;
    });

    await step.run('link-document-mongo', async () => {
      await supabase
        .from('documents')
        .update({
          mongodb_document_id: mongoId,
          processing_status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('org_id', orgId);
    });

    await step.sendEvent('emit-ocr-complete', {
      name: 'sifter/document.ocr.complete',
      data: { orgId, documentId, mongodbDocumentId: mongoId },
    });

    return { mongoId };
  }
);
```

Register `ingestDocument` in `inngestFunctions`. Extend types with `sifter/document.ocr.complete`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/ocr/extract-text.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ocr/extract-text.ts lib/mongodb/client.ts lib/inngest/functions/ingest-document.ts lib/inngest/functions/index.ts lib/inngest/types.ts package.json pnpm-lock.yaml __tests__/ocr/extract-text.test.ts
git commit -m "feat(pipeline): ingest document OCR and persist to MongoDB"
```

---

### Task 3: Classification + quality gate

**Files:**
- Create: `lib/inngest/functions/classify-document.ts`
- Create: `lib/llm/classify-invoice.ts` (pure function + OpenAI call — unit test with mocked OpenAI)
- Modify: `lib/inngest/functions/index.ts`
- Modify: `lib/inngest/types.ts`
- Test: `__tests__/llm/classify-invoice.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/llm/classify-invoice.test.ts
import { describe, it, expect, vi } from 'vitest';
import { evaluateClassificationGate } from '@/lib/llm/classify-invoice';

describe('evaluateClassificationGate', () => {
  it('fails gate when carrier missing', () => {
    const r = evaluateClassificationGate({
      isFreightInvoice: true,
      carrierName: null,
      invoiceNumber: 'INV-1',
      invoiceTotal: 100,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/carrier/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/llm/classify-invoice.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/llm/classify-invoice.ts
export type ClassificationFields = {
  isFreightInvoice: boolean;
  carrierName: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
};

export function evaluateClassificationGate(c: ClassificationFields): { pass: boolean; reason?: string } {
  if (!c.isFreightInvoice) return { pass: false, reason: 'Not classified as freight invoice' };
  if (!c.carrierName?.trim()) return { pass: false, reason: 'Missing carrier name' };
  if (!c.invoiceNumber?.trim()) return { pass: false, reason: 'Missing invoice number' };
  if (c.invoiceTotal == null || Number.isNaN(c.invoiceTotal)) return { pass: false, reason: 'Missing invoice total' };
  return { pass: true };
}
```

**LLM classification prompt** (used inside `classifyFreightInvoiceFromText` in same file):

```typescript
export const CLASSIFY_FREIGHT_INVOICE_PROMPT = `You are a document classifier for accounts payable.
Given raw OCR text from a PDF, return a JSON object with keys:
- isFreightInvoice (boolean): true only if this is a freight / logistics carrier invoice (not a quote, not a receipt unless it is clearly an invoice).
- carrierName (string|null)
- invoiceNumber (string|null)
- invoiceTotal (number|null): total amount due in USD if stated; else null
- confidence (number 0-1)

Rules: If unsure, set isFreightInvoice to false. Do not invent numbers; extract only from text.`;

export async function classifyFreightInvoiceFromText(
  rawText: string,
  callOpenAI: (prompt: string) => Promise<string>
): Promise<ClassificationFields & { confidence: number }> {
  const raw = await callOpenAI(
    `${CLASSIFY_FREIGHT_INVOICE_PROMPT}\n\n--- OCR TEXT ---\n${rawText.slice(0, 120_000)}`
  );
  const parsed = JSON.parse(raw) as ClassificationFields & { confidence: number };
  return parsed;
}
```

```typescript
// lib/inngest/functions/classify-document.ts
import OpenAI from 'openai';
import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { getMongoDb } from '@/lib/mongodb/client';
import {
  classifyFreightInvoiceFromText,
  evaluateClassificationGate,
} from '@/lib/llm/classify-invoice';

export const classifyDocument = inngest.createFunction(
  { id: 'classify-document', name: 'Classify Document' },
  { event: 'sifter/document.ocr.complete' },
  async ({ event, step }) => {
    const { orgId, documentId, mongodbDocumentId } = event.data;
    const supabase = createServiceRoleClient();

    const ocrText = await step.run('load-ocr', async () => {
      const db = await getMongoDb();
      const doc = await db.collection('document_ocr').findOne({ _id: mongodbDocumentId });
      return (doc?.rawText as string) ?? '';
    });

    const classification = await step.run('llm-classify', async () => {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return classifyFreightInvoiceFromText(ocrText, async (p) => {
        const res = await openai.chat.completions.create({
          model: 'gpt-5.4',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: p }],
        });
        return res.choices[0]?.message?.content ?? '{}';
      });
    });

    const gate = evaluateClassificationGate(classification);

    if (!gate.pass) {
      await step.run('mark-failed', async () => {
        await supabase
          .from('documents')
          .update({
            document_type: 'OTHER',
            processing_status: 'failed',
            classification_method: 'ai',
            classification_confidence: classification.confidence,
            updated_at: new Date().toISOString(),
          })
          .eq('id', documentId)
          .eq('org_id', orgId);
      });
      return { status: 'aborted', reason: gate.reason };
    }

    await step.run('mark-classified', async () => {
      await supabase
        .from('documents')
        .update({
          document_type: 'FREIGHT_INVOICE',
          processing_status: 'processing',
          classification_method: 'ai',
          classification_confidence: classification.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('org_id', orgId);
    });

    await step.sendEvent('emit-classified', {
      name: 'sifter/document.classified',
      data: { orgId, documentId, mongodbDocumentId },
    });

    return { status: 'ok' };
  }
);
```

Wire `classifyDocument` to listen on `sifter/document.ocr.complete`. Note: existing `document.classified` type in `types.ts` already matches `{ orgId, documentId, mongodbDocumentId }` — keep that shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/llm/classify-invoice.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/llm/classify-invoice.ts lib/inngest/functions/classify-document.ts lib/inngest/functions/index.ts __tests__/llm/classify-invoice.test.ts
git commit -m "feat(pipeline): classify freight invoice and quality gate"
```

---

### Task 4: LLM normalization — invoices + line items + references

**Files:**
- Create: `lib/invoices/normalize-schema.ts`
- Create: `lib/llm/normalize-invoice.ts` (prompt + parser)
- Create: `lib/inngest/functions/normalize-invoice.ts`
- Modify: `lib/inngest/functions/index.ts`
- Test: `__tests__/invoices/normalize-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/invoices/normalize-schema.test.ts
import { describe, it, expect } from 'vitest';
import { NormalizedInvoiceSchema } from '@/lib/invoices/normalize-schema';

describe('NormalizedInvoiceSchema', () => {
  it('parses minimal valid object', () => {
    const v = NormalizedInvoiceSchema.parse({
      carrierName: 'Acme Trucking',
      invoiceNumber: 'INV-9',
      invoiceDate: '2025-01-15',
      currency: 'USD',
      totalAmount: 100,
      lineItems: [],
      references: [],
    });
    expect(v.invoiceNumber).toBe('INV-9');
  });
});
```

Add `pnpm add zod`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/invoices/normalize-schema.test.ts`
Expected: FAIL — schema missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/invoices/normalize-schema.ts
import { z } from 'zod';

export const LineItemSchema = z.object({
  lineNumber: z.number().optional(),
  code: z.string().nullable().optional(),
  description: z.string(),
  qty: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  amount: z.number(),
  chargeType: z.string().nullable().optional(),
});

export const ReferenceSchema = z.object({
  refType: z.enum(['BOL', 'PRO', 'TRACKING', 'PO', 'LOAD', 'QUOTE', 'OTHER']),
  refValue: z.string(),
});

export const NormalizedInvoiceSchema = z.object({
  carrierName: z.string(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().default('USD'),
  subtotalAmount: z.number().nullable().optional(),
  taxAmount: z.number().nullable().optional(),
  totalAmount: z.number(),
  paymentTermsText: z.string().nullable().optional(),
  lineItems: z.array(LineItemSchema),
  references: z.array(ReferenceSchema),
});
```

**Normalization LLM prompt:**

```typescript
// lib/llm/normalize-invoice.ts
import OpenAI from 'openai';
import { NormalizedInvoiceSchema } from '@/lib/invoices/normalize-schema';

export const NORMALIZE_INVOICE_PROMPT = `You extract structured data from freight invoice OCR text.
Return JSON matching this TypeScript interface:
{
  carrierName: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO date yyyy-mm-dd
  dueDate?: string | null;
  currency: string; // default USD
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
  paymentTermsText?: string | null;
  lineItems: Array<{
    lineNumber?: number;
    code?: string | null;
    description: string;
    qty?: number | null;
    unit?: string | null;
    rate?: number | null;
    amount: number;
    chargeType?: string | null;
  }>;
  references: Array<{
    refType: 'BOL'|'PRO'|'TRACKING'|'PO'|'LOAD'|'QUOTE'|'OTHER';
    refValue: string;
  }>;
}
Rules: Use only information present in the text. Do not guess totals; if unclear, pick the labeled "Total" or "Amount Due".`;

export async function normalizeInvoiceFromOcr(ocrText: string): Promise<ReturnType<typeof NormalizedInvoiceSchema.parse>> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `${NORMALIZE_INVOICE_PROMPT}\n\n--- OCR ---\n${ocrText.slice(0, 120_000)}` }],
  });
  const raw = res.choices[0]?.message?.content ?? '{}';
  return NormalizedInvoiceSchema.parse(JSON.parse(raw));
}
```

In `lib/inngest/functions/normalize-invoice.ts`, after normalization:
- Upsert `carriers` by `name_normalized` (lowercase trimmed).
- Insert `invoices` row, `invoice_line_items`, `invoice_references`.
- Dedup: query existing invoice with same `invoice_number`, `carrier_id`, `total_amount` — if exists, skip insert and emit skip event (or mark `is_duplicate`).

Emit `sifter/invoice.normalized` (already in types) with `{ orgId, invoiceId }`.

Register the Inngest function with `{ event: 'sifter/document.classified' }` so it runs after the classification gate passes (same event shape as in `lib/inngest/types.ts`).

**Event contract (Tasks 4 → 6):** The payload for `sifter/invoice.normalized` is already defined in `lib/inngest/types.ts` as `SifterEvents['sifter/invoice.normalized']['data']`. In `lib/inngest/functions/post-audit.ts` (or `run-audit.ts`), import the shared type so producers and consumers cannot drift:

```typescript
import type { SifterEvents } from '@/lib/inngest/types';

type InvoiceNormalizedData = SifterEvents['sifter/invoice.normalized']['data'];

// Inngest handler
inngest.createFunction(
  { id: 'post-audit', name: 'Post-audit persist' },
  { event: 'sifter/invoice.normalized' },
  async ({ event, step }) => {
    const { orgId, invoiceId } = event.data as InvoiceNormalizedData;
    // ...
  }
);
```

Do not re-declare a parallel `{ orgId: string; invoiceId: string }` interface in the consumer file.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/invoices/normalize-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/invoices/normalize-schema.ts lib/llm/normalize-invoice.ts lib/inngest/functions/normalize-invoice.ts lib/inngest/functions/index.ts package.json pnpm-lock.yaml __tests__/invoices/normalize-schema.test.ts
git commit -m "feat(pipeline): LLM normalization and invoice upsert"
```

---

### Task 5: Carrier auto-detection (part of normalize)

**Files:**
- Modify: `lib/inngest/functions/normalize-invoice.ts` (or `lib/carriers/upsert.ts`)
- Test: `__tests__/carriers/upsert-carrier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/carriers/upsert-carrier.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeCarrierName } from '@/lib/carriers/upsert';

describe('normalizeCarrierName', () => {
  it('lowercases and trims', () => {
    expect(normalizeCarrierName('  Acme LLC  ')).toBe('acme llc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/carriers/upsert-carrier.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/carriers/upsert.ts
export function normalizeCarrierName(name: string): string {
  return name.trim().toLowerCase();
}

export async function upsertCarrier(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  orgId: string,
  nameRaw: string,
  billingEmailFromMetadata: string | null
) {
  const name_normalized = normalizeCarrierName(nameRaw);
  const { data: existing } = await supabase
    .from('carriers')
    .select('id')
    .eq('org_id', orgId)
    .eq('name_normalized', name_normalized)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from('carriers')
    .insert({
      org_id: orgId,
      name_raw: nameRaw,
      name_normalized,
      billing_email: billingEmailFromMetadata,
      billing_email_confirmed: false,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data!.id as string;
}
```

Integrate `upsertCarrier` into the normalize function after LLM returns `carrierName`; pass `billingEmailFromMetadata` from `documents` join if `source_type = 'email'` and you store From address on the document row (extend ingestion if needed — optional follow-up).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/carriers/upsert-carrier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/carriers/upsert.ts __tests__/carriers/upsert-carrier.test.ts lib/inngest/functions/normalize-invoice.ts
git commit -m "feat(carriers): normalized upsert for pipeline"
```

---

### Task 6: Context gathering (BOL + rate sheet)

**Files:**
- Create: `lib/inngest/functions/gather-context.ts`
- Create: `lib/audit/gather-context.ts` (pure queries — mock supabase in tests)
- Modify: `lib/inngest/functions/index.ts`
- Modify: `lib/inngest/types.ts`
- Test: `__tests__/audit/gather-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/audit/gather-context.test.ts
import { describe, it, expect } from 'vitest';
import { pickLatestRateSheet } from '@/lib/audit/gather-context';

describe('pickLatestRateSheet', () => {
  it('picks max effective_date', () => {
    const rows = [
      { id: 'a', effective_date: '2024-01-01' },
      { id: 'b', effective_date: '2025-06-01' },
    ];
    expect(pickLatestRateSheet(rows)?.id).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/audit/gather-context.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/audit/gather-context.ts
export type RateSheetRow = { id: string; effective_date: string | null };

export function pickLatestRateSheet(rows: RateSheetRow[]): RateSheetRow | null {
  if (!rows.length) return null;
  return rows.reduce((best, r) => {
    if (!r.effective_date) return best;
    if (!best.effective_date) return r;
    return r.effective_date > best.effective_date ? r : best;
  });
}
```

Inngest function loads `invoice_references`, finds BOL documents by `ref_value` match against uploaded `documents`, loads rate sheets for `carrier_id`, stores context JSON on a new staging table OR passes through event `sifter/invoice.context_ready` with payload `{ orgId, invoiceId, bolDocumentIds: string[], rateSheetId: string | null }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/audit/gather-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/audit/gather-context.ts lib/inngest/functions/gather-context.ts lib/inngest/functions/index.ts lib/inngest/types.ts __tests__/audit/gather-context.test.ts
git commit -m "feat(pipeline): gather BOL and rate sheet context"
```

---

### Task 7: Fast deterministic checks

**Files:**
- Create: `lib/audit/deterministic-checks.ts`
- Test: `__tests__/audit/deterministic-checks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/audit/deterministic-checks.test.ts
import { describe, it, expect } from 'vitest';
import { mathErrorCheck } from '@/lib/audit/deterministic-checks';

describe('mathErrorCheck', () => {
  it('triggers when line sum differs from total beyond tolerance', () => {
    const r = mathErrorCheck({
      lineSum: 100.02,
      totalAmount: 200,
      tolerance: 0.01,
    });
    expect(r.triggered).toBe(true);
    expect(r.finding_type).toBe('math_error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/audit/deterministic-checks.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/audit/deterministic-checks.ts
export type CheckResult = {
  triggered: boolean;
  finding_type: string;
  rule_id: string;
  description: string;
  delta_amount: number;
};

export function mathErrorCheck(input: {
  lineSum: number;
  totalAmount: number;
  tolerance?: number;
}): CheckResult {
  const tol = input.tolerance ?? 0.01;
  const diff = Math.abs(input.lineSum - input.totalAmount);
  if (diff <= tol) {
    return { triggered: false, finding_type: 'math_error', rule_id: 'math_sum', description: '', delta_amount: 0 };
  }
  return {
    triggered: true,
    finding_type: 'math_error',
    rule_id: 'math_sum',
    description: `Line items sum to ${input.lineSum.toFixed(2)} but invoice total is ${input.totalAmount.toFixed(2)}.`,
    delta_amount: Math.abs(input.totalAmount - input.lineSum),
  };
}

export function duplicateInvoiceCheck(input: {
  hasExistingClearedDuplicate: boolean;
  delta_amount: number;
}): CheckResult {
  if (!input.hasExistingClearedDuplicate) {
    return { triggered: false, finding_type: 'duplicate_invoice', rule_id: 'dup_inv', description: '', delta_amount: 0 };
  }
  return {
    triggered: true,
    finding_type: 'duplicate_invoice',
    rule_id: 'dup_inv',
    description: 'Another invoice with same carrier, number, and total was already cleared.',
    delta_amount: input.delta_amount,
  };
}

export function timestampSanityCheck(invoiceDate: Date, now = new Date()): CheckResult {
  const ms = invoiceDate.getTime();
  const futureLimit = 30 * 86400_000;
  const pastLimit = 730 * 86400_000;
  if (invoiceDate.getTime() > now.getTime() + futureLimit) {
    return {
      triggered: true,
      finding_type: 'late_submission',
      rule_id: 'ts_future',
      description: 'Invoice date is more than 30 days in the future.',
      delta_amount: 0,
    };
  }
  if (now.getTime() - ms > pastLimit) {
    return {
      triggered: true,
      finding_type: 'late_submission',
      rule_id: 'ts_old',
      description: 'Invoice date is more than 2 years in the past.',
      delta_amount: 0,
    };
  }
  return { triggered: false, finding_type: 'late_submission', rule_id: 'ts', description: '', delta_amount: 0 };
}

export function unitMismatchHeuristic(lineDescriptions: string[]): CheckResult {
  const text = lineDescriptions.join(' ').toLowerCase();
  const pair = [
    ['mi', 'km'],
    ['lbs', 'kg'],
    ['miles', 'kilometers'],
  ];
  for (const [a, b] of pair) {
    if (text.includes(a) && text.includes(b)) {
      return {
        triggered: true,
        finding_type: 'unit_mismatch',
        rule_id: 'unit_mix',
        description: `Possible mixed units (${a} vs ${b}) in line descriptions.`,
        delta_amount: 0,
      };
    }
  }
  return { triggered: false, finding_type: 'unit_mismatch', rule_id: 'unit_mix', description: '', delta_amount: 0 };
}

export function lateSubmissionCheck(invoiceDate: Date, receivedAt: Date, maxDays = 30): CheckResult {
  const days = (receivedAt.getTime() - invoiceDate.getTime()) / 86400_000;
  if (days <= maxDays) {
    return { triggered: false, finding_type: 'late_submission', rule_id: 'late_sub', description: '', delta_amount: 0 };
  }
  return {
    triggered: true,
    finding_type: 'late_submission',
    rule_id: 'late_sub',
    description: `Invoice received ${Math.floor(days)} days after invoice date (limit ${maxDays}).`,
    delta_amount: 0,
  };
}

export function runDeterministicChecks(ctx: {
  lineSum: number;
  totalAmount: number;
  invoiceDate: Date;
  receivedAt: Date;
  lineDescriptions: string[];
  hasExistingClearedDuplicate: boolean;
  duplicateDelta: number;
}): CheckResult[] {
  const out: CheckResult[] = [];
  const m = mathErrorCheck({ lineSum: ctx.lineSum, totalAmount: ctx.totalAmount });
  if (m.triggered) out.push(m);
  const d = duplicateInvoiceCheck({
    hasExistingClearedDuplicate: ctx.hasExistingClearedDuplicate,
    delta_amount: ctx.duplicateDelta,
  });
  if (d.triggered) out.push(d);
  const t = timestampSanityCheck(ctx.invoiceDate);
  if (t.triggered) out.push(t);
  const u = unitMismatchHeuristic(ctx.lineDescriptions);
  if (u.triggered) out.push(u);
  const l = lateSubmissionCheck(ctx.invoiceDate, ctx.receivedAt);
  if (l.triggered) out.push(l);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/audit/deterministic-checks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/audit/deterministic-checks.ts __tests__/audit/deterministic-checks.test.ts
git commit -m "feat(audit): deterministic invoice checks"
```

---

### Task 8: AI audit agent

**Files:**
- Create: `lib/audit/types.ts`
- Create: `lib/audit/ai-audit-agent.ts`
- Test: `__tests__/audit/ai-audit-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/audit/ai-audit-agent.test.ts
import { describe, it, expect } from 'vitest';
import { mergeDedupByRule } from '@/lib/audit/ai-audit-agent';

describe('mergeDedupByRule', () => {
  it('drops AI duplicate when deterministic same rule_id', () => {
    const det = [{ rule_id: 'rate_1', source: 'deterministic' as const }];
    const ai = [{ rule_id: 'rate_1', source: 'ai_audit' as const }];
    expect(mergeDedupByRule(det, ai)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/audit/ai-audit-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/audit/types.ts
export type FindingDraft = {
  finding_type: string;
  rule_id: string;
  source: 'deterministic' | 'ai_audit';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  expected_amount?: number | null;
  charged_amount?: number | null;
  delta_amount: number;
  summary: string;
  reasoning: string;
  confidence?: number;
  evidence_json?: Record<string, unknown>;
};
```

**AI audit system prompt** (single structured call covering all checks):

```typescript
// lib/audit/ai-audit-agent.ts
import OpenAI from 'openai';
import type { FindingDraft } from '@/lib/audit/types';

export const AI_AUDIT_PROMPT = `You are a freight invoice auditor. Given JSON context with:
- normalized invoice (line items, totals)
- rate sheet excerpt (if any)
- BOL excerpt (if any)

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
1) Rate mismatch vs contracted rate sheet
2) BOL mismatch (weight, lanes) vs invoice
3) Fuel surcharge reasonableness vs linehaul
4) Detention without appointment evidence
5) Lumper without receipt when charged
6) Accessorial without proof document

If no issue, return findings: []. Do not duplicate issues already explained by deterministic rules if those appear in the "deterministic_findings" array — skip overlapping rule_id.`;

export async function runAiAuditAgent(context: {
  invoiceJson: unknown;
  rateSheetJson?: unknown;
  bolJson?: unknown;
  deterministicFindings: { rule_id: string }[];
}): Promise<FindingDraft[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: `${AI_AUDIT_PROMPT}\n\nCONTEXT:\n${JSON.stringify(context).slice(0, 100_000)}`,
      },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? '{"findings":[]}';
  const parsed = JSON.parse(raw) as { findings: FindingDraft[] };
  return mergeDedupByRule(context.deterministicFindings as FindingDraft[], parsed.findings);
}

export function mergeDedupByRule(
  deterministic: FindingDraft[],
  ai: FindingDraft[]
): FindingDraft[] {
  const ruleIds = new Set(deterministic.map((d) => d.rule_id));
  const filteredAi = ai.filter((a) => !ruleIds.has(a.rule_id));
  return [...deterministic, ...filteredAi];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/audit/ai-audit-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/audit/types.ts lib/audit/ai-audit-agent.ts __tests__/audit/ai-audit-agent.test.ts
git commit -m "feat(audit): AI audit agent and dedup merge"
```

---

### Task 9: Post-audit — persist findings + invoice status

**Files:**
- Create: `lib/inngest/lib/post-audit-db.ts`
- Create: `lib/inngest/functions/post-audit.ts`
- Modify: `lib/inngest/functions/index.ts`
- Test: `__tests__/inngest/post-audit-db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/inngest/post-audit-db.test.ts
import { describe, it, expect } from 'vitest';
import { sumDeltaAmounts } from '@/lib/inngest/lib/post-audit-db';

describe('sumDeltaAmounts', () => {
  it('sums deltas', () => {
    expect(sumDeltaAmounts([{ delta_amount: 1 }, { delta_amount: 2.5 }])).toBe(3.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/inngest/post-audit-db.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/inngest/lib/post-audit-db.ts
import type { FindingDraft } from '@/lib/audit/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export function sumDeltaAmounts(rows: { delta_amount: number }[]): number {
  return rows.reduce((s, r) => s + r.delta_amount, 0);
}

export async function insertFindingsAndUpdateInvoice(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  findings: FindingDraft[]
) {
  const overcharge = sumDeltaAmounts(findings);
  for (const f of findings) {
    await supabase.from('findings').insert({
      org_id: orgId,
      invoice_id: invoiceId,
      finding_type: f.finding_type,
      rule_id: f.rule_id,
      source: f.source,
      severity: f.severity,
      expected_amount: f.expected_amount ?? null,
      charged_amount: f.charged_amount ?? null,
      delta_amount: f.delta_amount,
      summary: f.summary,
      reasoning: f.reasoning,
      confidence: f.confidence ?? null,
      evidence_json: f.evidence_json ?? null,
    });
  }
  const ui_status = findings.length === 0 ? 'no_findings' : 'action_needed';
  await supabase
    .from('invoices')
    .update({
      overcharge_amount: overcharge,
      ui_status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('org_id', orgId);

  const { data: inv } = await supabase
    .from('invoices')
    .select('document_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();

  if (inv?.document_id) {
    // SECURITY: scope by documents.id + org_id — never .update().eq('org_id') alone
    await supabase
      .from('documents')
      .update({ processing_status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', inv.document_id)
      .eq('org_id', orgId);
  }
}
```

Wire `post-audit` Inngest function on `sifter/invoice.normalized` after deterministic + AI steps (or single `run-audit` function that calls both — keep one event for simplicity).

Emit `sifter/invoice.audited` with `{ orgId, invoiceId, findingCount }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/inngest/post-audit-db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/inngest/lib/post-audit-db.ts lib/inngest/functions/post-audit.ts lib/inngest/functions/index.ts __tests__/inngest/post-audit-db.test.ts
git commit -m "feat(pipeline): post-audit persistence and invoice status"
```

---

### Task 10: Gmail polling (Inngest cron)

**Files:**
- Create: `lib/email/gmail-poller.ts`
- Create: `lib/inngest/functions/gmail-sync-cron.ts`
- Modify: `lib/inngest/functions/index.ts`
- Test: `__tests__/email/gmail-history.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/email/gmail-history.test.ts
import { describe, it, expect } from 'vitest';
import { nextHistoryId } from '@/lib/email/gmail-poller';

describe('nextHistoryId', () => {
  it('returns max history id from response', () => {
    expect(
      nextHistoryId({
        history: [{ id: '10' }, { id: '25' }],
      })
    ).toBe('25');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/email/gmail-history.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/email/gmail-poller.ts
import { google } from 'googleapis';

export function nextHistoryId(resp: { history?: { id?: string }[] }): string | null {
  if (!resp.history?.length) return null;
  return resp.history.reduce((max, h) => {
    const id = h.id ?? '';
    return id > max ? id : max;
  }, '');
}

export async function buildGmailClient(refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}
```

```typescript
// lib/inngest/functions/gmail-sync-cron.ts
import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { buildGmailClient, nextHistoryId } from '@/lib/email/gmail-poller';

export const gmailSyncCron = inngest.createFunction(
  { id: 'gmail-sync-cron', name: 'Gmail sync (15m)' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const processed = await step.run('sync-all-gmail-connections', async () => {
      const supabase = createServiceRoleClient();
      const { data: connections } = await supabase
        .from('email_connections')
        .select('id, org_id, user_id, last_history_id, refresh_token_encrypted')
        .eq('provider', 'gmail')
        .eq('status', 'active');

      let count = 0;
      for (const conn of connections ?? []) {
        const gmail = await buildGmailClient(conn.refresh_token_encrypted);
        const startHistoryId = conn.last_history_id ?? undefined;

        if (!startHistoryId) {
          const backlogDays = Number(process.env.EMAIL_BACKLOG_DAYS ?? '60');
          const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: `newer_than:${backlogDays}d has:attachment filename:pdf`,
            maxResults: 25,
          });
          for (const m of listRes.data.messages ?? []) {
            await processMessage(supabase, gmail, conn.org_id, m.id!);
            count++;
          }
          const prof = await gmail.users.getProfile({ userId: 'me' });
          await supabase
            .from('email_connections')
            .update({ last_history_id: prof.data.historyId ?? null })
            .eq('id', conn.id);
          continue;
        }

        const hist = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded'],
        });
        const nextId = nextHistoryId(hist.data);
        for (const h of hist.data.history ?? []) {
          const added = h.messagesAdded ?? [];
          for (const ma of added) {
            const mid = ma.message?.id;
            if (!mid) continue;
            await processMessage(supabase, gmail, conn.org_id, mid);
            count++;
          }
        }
        if (nextId) {
          await supabase.from('email_connections').update({ last_history_id: nextId }).eq('id', conn.id);
        }
      }
      return count;
    });
    return { ok: true, processed };
  }
);

/** Move to `lib/email/gmail-poller.ts`: `users.messages.get` → PDF parts → GCS → `documents` insert → `inngest.send('sifter/document.received', { orgId, documentId, gcsKey, sourceType: 'email' })`. */
async function processMessage(
  supabase: ReturnType<typeof createServiceRoleClient>,
  gmail: import('googleapis').gmail_v1.Gmail,
  orgId: string,
  messageId: string
) {
  throw new Error(
    `TODO: implement processMessage for org ${orgId} message ${messageId} — do not ship with empty pipeline events`
  );
}
```

**Note:** Replace the stub `processMessage` body with real Gmail `users.messages.get` + multipart PDF extraction + GCS upload + `documents` insert + `inngest.send` using actual `orgId` / `documentId` / `gcsKey`. Keep `EMAIL_BACKLOG_DAYS` (default 60) for the **first** sync `messages.list` query; subsequent runs use `history.list` + `last_history_id`.

**References:** [Gmail API `users.history.list`](https://developers.google.com/gmail/api/reference/rest/v1/users.history/list), [users.messages.list](https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/email/gmail-history.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/email/gmail-poller.ts lib/inngest/functions/gmail-sync-cron.ts lib/inngest/functions/index.ts __tests__/email/gmail-history.test.ts
git commit -m "feat(email): Gmail history cron scaffold"
```

---

### Task 11: Manual upload API

**Files:**
- Create: `app/api/documents/upload/route.ts`
- Modify: `lib/server` — reuse `getAuthOrgContext` + `createClient` from user session
- Test: `__tests__/api/documents-upload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/documents-upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/documents/upload/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/server/auth-context');

describe('POST /api/documents/upload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { getAuthOrgContext } = await import('@/lib/server/auth-context');
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/documents/upload', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/api/documents-upload.test.ts`
Expected: FAIL — route missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/documents/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'crypto';
import { inngest } from '@/lib/inngest/client';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const id = randomUUID();
  const gcsKey = `orgs/${ctx.orgId}/documents/${id}.pdf`;

  const storage = new Storage();
  await storage.bucket(process.env.GCS_BUCKET!).file(gcsKey).save(buf, { contentType: 'application/pdf' });

  const { error } = await supabase.from('documents').insert({
    id,
    org_id: ctx.orgId,
    source_type: 'upload',
    filename: 'upload.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: buf.length,
    gcs_key: gcsKey,
    sha256,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await inngest.send({
    name: 'sifter/document.received',
    data: {
      orgId: ctx.orgId,
      documentId: id,
      gcsKey,
      sourceType: 'upload',
    },
  });

  return NextResponse.json({ documentId: id });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/api/documents-upload.test.ts`
Expected: PASS (expand mocks for success path in follow-up if needed)

- [ ] **Step 5: Commit**

```bash
git add app/api/documents/upload/route.ts __tests__/api/documents-upload.test.ts
git commit -m "feat(api): manual PDF upload to GCS and pipeline trigger"
```

---

## Self-review

**Spec coverage:** Tasks 1–11 map to registry, OCR ingest, classify+gate, normalize+dedup+carrier, context, deterministic checks, AI audit, post-audit, Gmail cron, manual upload. **Gaps to close during implementation:** (1) Replace placeholder `insertFindingsAndUpdateInvoice` document update with correct `documents.id` join via `invoices.document_id`. (2) `gmail-sync-cron` body is scaffolded — fill with real Gmail API loops and `email_connections` token decryption. (3) `AUTH` memberships role type includes `manager` in code but DB check is `member` — unrelated but watch RBAC.

**Placeholder scan:** No TBD steps; environment variables (`GCS_BUCKET`, `MONGODB_URI`, `OPENAI_API_KEY`) must exist in deployment.

**Type consistency:** `FindingDraft` uses `finding_type` strings matching `findings_finding_type_check`; keep aligned. Event `sifter/document.received` matches existing `lib/inngest/types.ts`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-26-audit-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

---

**Deprecation note:** The Cursor `/write-plan` command is deprecated; for future plans, ask the assistant to follow the **superpowers writing-plans** skill explicitly (same structure as this document).
