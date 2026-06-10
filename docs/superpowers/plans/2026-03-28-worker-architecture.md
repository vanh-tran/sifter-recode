# Worker Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the full document pipeline (and related jobs) in a **BullMQ + Upstash Redis + Fly.io worker** — a persistent Node.js process without serverless timeout constraints.

**Architecture:** Vercel enqueues jobs via BullMQ; a Fly.io worker polls three queues (`document-pipeline`, `gmail-sync`, `email-events`) and runs all processing end-to-end. `lib/` shared code moves to a `packages/core/` workspace package (`@sifter/core`) so the worker image never contains Next.js.

**Tech Stack:** BullMQ, IORedis, Upstash Redis, Fly.io Machines API, pnpm workspaces, Express + @bull-board for observability

---

## File Structure

**New files:**
```
packages/core/
├── package.json                      # name: "@sifter/core"
├── tsconfig.json
└── src/
    ├── index.ts                      # barrel re-exports
    ├── supabase/service-role.ts      # moved from lib/
    ├── mongodb/client.ts             # moved from lib/
    ├── ocr/extract-text.ts           # moved from lib/
    ├── email/gmail-poller.ts         # moved from lib/
    ├── email/send-dispute.ts         # moved from lib/
    ├── llm/classify-invoice.ts       # moved from lib/
    ├── llm/normalize-invoice.ts      # moved from lib/
    ├── audit/types.ts                # moved from lib/
    ├── audit/deterministic-checks.ts # moved from lib/
    ├── audit/ai-audit-agent.ts       # moved from lib/
    ├── audit/gather-context.ts       # moved from lib/
    ├── audit/post-audit-db.ts        # moved from lib/ (or authored in core)
    ├── carriers/upsert.ts            # moved from lib/
    ├── invoices/normalize-schema.ts  # moved from lib/
    ├── server/oauth-token-crypto.ts  # moved from lib/
    └── queue/
        ├── index.ts                  # exports queues + connection
        └── types.ts                  # job payload types

worker/src/
├── stages/
│   ├── ocr.ts
│   ├── classify.ts
│   ├── normalize.ts
│   ├── gather-context.ts
│   └── post-audit.ts
├── jobs/
│   ├── document-pipeline.ts
│   ├── gmail-sync.ts
│   └── email-events.ts
├── workers.ts
├── scaler.ts
├── board.ts
└── index.ts

worker/Dockerfile
worker/fly.toml
```

**Modified files:**
- `pnpm-workspace.yaml` — add packages: entries
- `package.json` (root) — rename to `sifter-web` if not already
- `tsconfig.json` (root) — add `@sifter/core/*` path alias
- `next.config.ts` — add `transpilePackages: ['@sifter/core']`
- `worker/package.json` — add bullmq, ioredis, express, @bull-board, googleapis, pdf-parse, @google-cloud/storage, @google-cloud/kms
- `app/api/documents/upload/route.ts` — call `documentPipelineQueue.add(...)` after upload
- All `lib/` files that stay — update `@/lib/` internal imports (they still work as-is via root tsconfig alias, no change needed)

---

## Task 1: pnpm Workspace + @sifter/core Scaffold

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Modify: `tsconfig.json` (root)
- Modify: `next.config.ts`

- [ ] **Step 1: Add workspace packages to pnpm-workspace.yaml**

Replace the full file content:

```yaml
packages:
  - 'packages/*'
  - 'worker'

ignoredBuiltDependencies:
  - sharp
  - unrs-resolver
```

- [ ] **Step 2: Rename root package to sifter-web**

In `package.json`, change `"name": "sifter"` to `"name": "sifter-web"`.

- [ ] **Step 3: Create packages/core/package.json**

```json
{
  "name": "@sifter/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./*": {
      "import": "./dist/*.js",
      "types": "./dist/*.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch"
  },
  "dependencies": {
    "@google-cloud/kms": "^4.2.0",
    "@google-cloud/storage": "^7.18.0",
    "@supabase/supabase-js": "^2.89.0",
    "mongodb": "^6.3.0",
    "openai": "^6.16.0",
    "googleapis": "^169.0.0",
    "pdf-parse": "^2.4.5"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/pdf-parse": "^1.1.5",
    "typescript": "^5"
  }
}
```

- [ ] **Step 4: Create packages/core/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Create packages/core/src/index.ts (barrel)**

```ts
// Supabase
export * from './supabase/service-role.js';
// MongoDB
export * from './mongodb/client.js';
// OCR
export * from './ocr/extract-text.js';
// Email
export * from './email/gmail-poller.js';
export * from './email/send-dispute.js';
// LLM
export * from './llm/classify-invoice.js';
export * from './llm/normalize-invoice.js';
// Audit
export * from './audit/types.js';
export * from './audit/deterministic-checks.js';
export * from './audit/ai-audit-agent.js';
export * from './audit/gather-context.js';
export * from './audit/post-audit-db.js';
// Carriers / Invoices
export * from './carriers/upsert.js';
export * from './invoices/normalize-schema.js';
// Server
export * from './server/oauth-token-crypto.js';
// Queue
export * from './queue/index.js';
export * from './queue/types.js';
```

- [ ] **Step 6: Add @sifter/core path alias to root tsconfig.json**

In `tsconfig.json` at root, add to `compilerOptions.paths`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"],
      "@sifter/core": ["./packages/core/src/index.ts"],
      "@sifter/core/*": ["./packages/core/src/*"]
    }
  }
}
```

- [ ] **Step 7: Add transpilePackages to next.config.ts**

Read `next.config.ts` and add `transpilePackages: ['@sifter/core']` to the config object.

- [ ] **Step 8: Run pnpm install**

```bash
cd /path/to/sifter-recode
pnpm install
```

Expected: workspace resolves, no errors about missing packages. `packages/core` and `worker` appear as workspace packages.

- [ ] **Step 9: Commit**

```bash
git add pnpm-workspace.yaml package.json packages/core/ tsconfig.json next.config.ts
git commit -m "chore: scaffold pnpm workspace with @sifter/core package"
```

---

## Task 2: Move lib/ Contents to packages/core/src/

**Files:**
- Create: all files listed in File Structure under `packages/core/src/` (except `queue/`)
- Internal imports within the moved files must use relative paths (e.g. `'../audit/types.js'`) instead of `@/lib/`

This task is a mechanical copy-and-fix. Files moved:

| Source | Destination |
|---|---|
| `lib/supabase/service-role.ts` | `packages/core/src/supabase/service-role.ts` |
| `lib/mongodb/client.ts` | `packages/core/src/mongodb/client.ts` |
| `lib/ocr/extract-text.ts` | `packages/core/src/ocr/extract-text.ts` |
| `lib/email/gmail-poller.ts` | `packages/core/src/email/gmail-poller.ts` |
| `lib/email/send-dispute.ts` | `packages/core/src/email/send-dispute.ts` |
| `lib/llm/classify-invoice.ts` | `packages/core/src/llm/classify-invoice.ts` |
| `lib/llm/normalize-invoice.ts` | `packages/core/src/llm/normalize-invoice.ts` |
| `lib/audit/types.ts` | `packages/core/src/audit/types.ts` |
| `lib/audit/deterministic-checks.ts` | `packages/core/src/audit/deterministic-checks.ts` |
| `lib/audit/ai-audit-agent.ts` | `packages/core/src/audit/ai-audit-agent.ts` |
| `lib/audit/gather-context.ts` | `packages/core/src/audit/gather-context.ts` |
| `lib/audit/post-audit-db.ts` (or equivalent) | `packages/core/src/audit/post-audit-db.ts` |
| `lib/carriers/upsert.ts` | `packages/core/src/carriers/upsert.ts` |
| `lib/invoices/normalize-schema.ts` | `packages/core/src/invoices/normalize-schema.ts` |
| `lib/server/oauth-token-crypto.ts` | `packages/core/src/server/oauth-token-crypto.ts` |

- [ ] **Step 1: Copy supabase/service-role.ts**

Create `packages/core/src/supabase/service-role.ts`. Copy content from `lib/supabase/service-role.ts` verbatim — it has no internal `@/lib/` imports.

- [ ] **Step 2: Copy mongodb/client.ts**

Create `packages/core/src/mongodb/client.ts`. Copy content from `lib/mongodb/client.ts` verbatim — no internal imports.

- [ ] **Step 3: Copy ocr/extract-text.ts**

Create `packages/core/src/ocr/extract-text.ts`. Copy from `lib/ocr/extract-text.ts` verbatim — no internal imports.

- [ ] **Step 4: Copy email/gmail-poller.ts**

Create `packages/core/src/email/gmail-poller.ts`. Copy from `lib/email/gmail-poller.ts` verbatim — no internal imports beyond `googleapis`.

- [ ] **Step 5: Copy email/send-dispute.ts**

Create `packages/core/src/email/send-dispute.ts`. Copy from `lib/email/send-dispute.ts`. If it imports from `@/lib/`, replace with relative path.

- [ ] **Step 6: Copy server/oauth-token-crypto.ts**

Create `packages/core/src/server/oauth-token-crypto.ts`. Copy from `lib/server/oauth-token-crypto.ts` verbatim.

- [ ] **Step 7: Copy llm/classify-invoice.ts and llm/normalize-invoice.ts**

Create both files. Copy verbatim — they have no internal imports. Check for `@/lib/` — there are none in these LLM utility files.

- [ ] **Step 8: Copy audit/ files**

Copy these four files, updating any `@/lib/` imports to relative paths:

`packages/core/src/audit/types.ts` — copy verbatim (no internal imports).

`packages/core/src/audit/deterministic-checks.ts` — copy verbatim (imports from `./types` if at all — check source first).

`packages/core/src/audit/ai-audit-agent.ts` — copy, replacing any `@/lib/audit/types` → `'./types.js'`.

`packages/core/src/audit/gather-context.ts` — copy verbatim.

`packages/core/src/audit/post-audit-db.ts` — copy from the app `lib/` source (or write fresh), replacing:
- `@/lib/audit/types` → `'./types.js'`

- [ ] **Step 9: Copy carriers/upsert.ts and invoices/normalize-schema.ts**

Copy both files. Replace any `@/lib/` imports with relative paths (check source for internal deps).

- [ ] **Step 10: Build packages/core to verify TypeScript compiles**

```bash
cd packages/core
pnpm build
```

Expected: `dist/` is created, no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/
git commit -m "feat: populate @sifter/core with shared business logic from lib/"
```

---

## Task 3: Update Next.js App Imports to @sifter/core

The Next.js app and its `lib/` files that were NOT moved still use `@/lib/...` imports. Files that WERE moved now live in two places — `lib/` still exists (untouched), so existing `@/lib/` imports in Next.js pages/components/routes continue to work. We do NOT need to rewrite all 179 imports right now.

**The only thing this task does:** add `@sifter/core` as a workspace dependency to `sifter-web` so Next.js can resolve it, and verify the build passes.

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add @sifter/core workspace dependency to root package.json**

In the root `package.json`, add to `dependencies`:

```json
"@sifter/core": "workspace:*"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: `node_modules/@sifter/core` is a symlink to `packages/core`.

- [ ] **Step 3: Verify packages/core is built**

```bash
cd packages/core && pnpm build
```

Expected: `packages/core/dist/` has compiled JS files.

- [ ] **Step 4: Verify Next.js builds without errors**

```bash
cd /path/to/sifter-recode
pnpm build 2>&1 | tail -20
```

Expected: Build completes with no errors from `@sifter/core`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @sifter/core as workspace dependency in sifter-web"
```

---

## Task 4: BullMQ Queue Definitions in @sifter/core

**Files:**
- Create: `packages/core/src/queue/types.ts`
- Create: `packages/core/src/queue/index.ts`
- Modify: `packages/core/src/index.ts` (already includes queue exports)

- [ ] **Step 1: Write the test first**

Create `packages/core/src/queue/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { DocumentPipelinePayload, GmailSyncPayload, EmailEventsPayload } from '../types.js';

describe('queue payload types', () => {
  it('DocumentPipelinePayload has required fields', () => {
    const payload: DocumentPipelinePayload = {
      orgId: 'org-1',
      documentId: 'doc-1',
      gcsKey: 'orgs/org-1/documents/doc-1.pdf',
      sourceType: 'upload',
    };
    expect(payload.orgId).toBe('org-1');
  });

  it('EmailEventsPayload has required fields', () => {
    const payload: EmailEventsPayload = {
      orgId: 'org-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      fromEmail: 'carrier@example.com',
      toEmails: ['ap@acme.com'],
      ccEmails: [],
      subject: 'Invoice',
      body: 'Please find attached',
      receivedAt: '2026-03-28T00:00:00Z',
    };
    expect(payload.messageId).toBe('msg-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (types don't exist yet)**

```bash
cd packages/core
pnpm exec vitest run src/queue/__tests__/types.test.ts
```

Expected: FAIL — cannot find module `../types.js`.

Actually since this is a pure TypeScript type check, the test will fail at import. That's the expected failure.

- [ ] **Step 3: Create packages/core/src/queue/types.ts**

```ts
export interface DocumentPipelinePayload {
  orgId: string;
  documentId: string;
  gcsKey: string;
  sourceType: 'upload' | 'email';
}

export interface GmailSyncPayload {
  // No fields — syncs all active connections
}

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

- [ ] **Step 4: Create packages/core/src/queue/index.ts**

```ts
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import type { DocumentPipelinePayload, GmailSyncPayload, EmailEventsPayload } from './types.js';

export { DocumentPipelinePayload, GmailSyncPayload, EmailEventsPayload } from './types.js';

let _connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!_connection) {
    const url = process.env.UPSTASH_REDIS_URL;
    if (!url) throw new Error('UPSTASH_REDIS_URL is not set');
    _connection = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return _connection;
}

export const documentPipelineQueue = new Queue<DocumentPipelinePayload>('document-pipeline', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

export const gmailSyncQueue = new Queue<GmailSyncPayload>('gmail-sync', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
  },
});

export const emailEventsQueue = new Queue<EmailEventsPayload>('email-events', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});
```

- [ ] **Step 5: Add bullmq and ioredis to packages/core dependencies**

In `packages/core/package.json`, add to `dependencies`:
```json
"bullmq": "^5.0.0",
"ioredis": "^5.3.0"
```

- [ ] **Step 6: Run pnpm install**

```bash
pnpm install
```

- [ ] **Step 7: Build packages/core**

```bash
cd packages/core && pnpm build
```

Expected: compiles without errors. `dist/queue/` appears.

- [ ] **Step 8: Run the type test**

Add vitest to packages/core devDeps and run:

```bash
# In packages/core/package.json devDependencies, add: "vitest": "^4.1.2"
pnpm install
pnpm exec vitest run src/queue/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/
git commit -m "feat: add BullMQ queue definitions to @sifter/core"
```

---

## Task 5: Worker Package Setup + Document Pipeline Stages

**Files:**
- Modify: `worker/package.json`
- Create: `worker/tsconfig.json` (already exists — verify it's correct)
- Create: `worker/src/stages/ocr.ts`
- Create: `worker/src/stages/classify.ts`
- Create: `worker/src/stages/normalize.ts`
- Create: `worker/src/stages/gather-context.ts`
- Create: `worker/src/stages/post-audit.ts`

- [ ] **Step 1: Update worker/package.json**

Replace content with:

```json
{
  "name": "sifter-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "rm -rf dist && tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@sifter/core": "workspace:*",
    "@google-cloud/storage": "^7.18.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.0",
    "@bull-board/api": "^6.0.0",
    "@bull-board/express": "^6.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20",
    "tsx": "^4.21.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Install worker dependencies**

```bash
pnpm install
```

Expected: worker gets `@sifter/core` symlinked, bullmq, ioredis, express, @bull-board installed.

- [ ] **Step 3: Create worker/src/stages/ocr.ts**

The OCR stage checks whether OCR was already done (idempotent), then downloads PDF from GCS, extracts text, stores in MongoDB, and updates the document record.

```ts
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import { extractTextFromPdfBuffer } from '@sifter/core/ocr/extract-text';

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
  // Idempotency check
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
    _id: mongoId,
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
```

- [ ] **Step 4: Create worker/src/stages/classify.ts**

```ts
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import {
  classifyFreightInvoiceFromText,
  evaluateClassificationGate,
} from '@sifter/core/llm/classify-invoice';

interface ClassifyStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

interface ClassifyResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Idempotent: skips LLM call if document_type is already set.
 * Returns { rejected: true } if document is not a freight invoice.
 */
export async function runClassifyStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: ClassifyStageInput
): Promise<ClassifyResult> {
  // Idempotency check
  const { data: existing } = await supabase
    .from('documents')
    .select('document_type')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .single();

  if (existing?.document_type) {
    return { rejected: existing.document_type !== 'FREIGHT_INVOICE' };
  }

  const doc = await db.collection('document_ocr').findOne({ _id: mongoDocId });
  const ocrText = (doc?.rawText as string) ?? '';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const classification = await classifyFreightInvoiceFromText(ocrText, async (p) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: p }],
    });
    return res.choices[0]?.message?.content ?? '{}';
  });

  const gate = evaluateClassificationGate(classification);

  if (!gate.pass) {
    await supabase
      .from('documents')
      .update({
        document_type: 'OTHER',
        processing_status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .eq('org_id', orgId);
    return { rejected: true, reason: gate.reason };
  }

  await supabase
    .from('documents')
    .update({
      document_type: 'FREIGHT_INVOICE',
      processing_status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('org_id', orgId);

  return { rejected: false };
}
```

- [ ] **Step 5: Create worker/src/stages/normalize.ts**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import { normalizeInvoiceFromOcr } from '@sifter/core/llm/normalize-invoice';

interface NormalizeStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

/**
 * Idempotent: skips if an invoice row already exists for this document_id.
 * Returns invoiceId.
 */
export async function runNormalizeStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: NormalizeStageInput
): Promise<string> {
  // Idempotency check
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('document_id', documentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (existing) return existing.id as string;

  const doc = await db.collection('document_ocr').findOne({ _id: mongoDocId });
  const ocrText = (doc?.rawText as string) ?? '';

  const normalized = await normalizeInvoiceFromOcr(ocrText);

  // Upsert carrier
  const nameNormalized = normalized.carrierName.trim().toLowerCase();
  const { data: existingCarrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('org_id', orgId)
    .eq('name_normalized', nameNormalized)
    .maybeSingle();

  let carrierId: string;
  if (existingCarrier) {
    carrierId = existingCarrier.id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from('carriers')
      .insert({ org_id: orgId, name_raw: normalized.carrierName, name_normalized: nameNormalized })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert carrier: ${error.message}`);
    carrierId = inserted.id as string;
  }

  // Dedup check
  const { data: dupInvoice } = await supabase
    .from('invoices')
    .select('id')
    .eq('org_id', orgId)
    .eq('invoice_number', normalized.invoiceNumber)
    .eq('carrier_id', carrierId)
    .eq('total_amount', normalized.totalAmount)
    .maybeSingle();

  if (dupInvoice) {
    await supabase
      .from('invoices')
      .update({ is_duplicate: true, updated_at: new Date().toISOString() })
      .eq('id', dupInvoice.id)
      .eq('org_id', orgId);
    return dupInvoice.id as string;
  }

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      org_id: orgId,
      document_id: documentId,
      carrier_id: carrierId,
      invoice_number: normalized.invoiceNumber,
      invoice_date: normalized.invoiceDate,
      due_date: normalized.dueDate ?? null,
      currency: normalized.currency,
      subtotal_amount: normalized.subtotalAmount ?? null,
      tax_amount: normalized.taxAmount ?? null,
      total_amount: normalized.totalAmount,
      payment_terms_text: normalized.paymentTermsText ?? null,
      ui_status: 'new',
      is_duplicate: false,
    })
    .select('id')
    .single();

  if (invErr) throw new Error(`Failed to insert invoice: ${invErr.message}`);
  const invoiceId = invoice.id as string;

  if (normalized.lineItems.length > 0) {
    const { error: liErr } = await supabase.from('invoice_line_items').insert(
      normalized.lineItems.map((item) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        line_number: item.lineNumber ?? null,
        code: item.code ?? null,
        description: item.description,
        qty: item.qty ?? null,
        unit: item.unit ?? null,
        rate: item.rate ?? null,
        amount: item.amount,
        charge_type: item.chargeType ?? null,
      }))
    );
    if (liErr) throw new Error(`Failed to insert line items: ${liErr.message}`);
  }

  if (normalized.references.length > 0) {
    const { error: refErr } = await supabase.from('invoice_references').insert(
      normalized.references.map((ref) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        ref_type: ref.refType,
        ref_value: ref.refValue,
      }))
    );
    if (refErr) throw new Error(`Failed to insert references: ${refErr.message}`);
  }

  return invoiceId;
}
```

- [ ] **Step 6: Create worker/src/stages/gather-context.ts**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickLatestRateSheet } from '@sifter/core/audit/gather-context';

interface GatherContextInput {
  orgId: string;
  invoiceId: string;
}

interface GatherContextResult {
  bolDocumentIds: string[];
  rateSheetId: string | null;
}

/**
 * Always runs — reads are idempotent. Finds BOL docs and latest rate sheet.
 */
export async function runGatherContextStage(
  supabase: SupabaseClient,
  { orgId, invoiceId }: GatherContextInput
): Promise<GatherContextResult> {
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, carrier_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();

  const { data: refs } = await supabase
    .from('invoice_references')
    .select('ref_value')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId);

  const refValues = (refs ?? []).map((r: { ref_value: string }) => r.ref_value).filter(Boolean);
  let bolDocumentIds: string[] = [];

  if (refValues.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('id')
      .eq('org_id', orgId)
      .eq('doc_type', 'bol')
      .in('ref_value', refValues);
    bolDocumentIds = (docs ?? []).map((d: { id: string }) => d.id);
  }

  let rateSheetId: string | null = null;
  if (inv?.carrier_id) {
    const { data: rateSheets } = await supabase
      .from('rate_sheets')
      .select('id, effective_date')
      .eq('org_id', orgId)
      .eq('carrier_id', inv.carrier_id);
    rateSheetId = pickLatestRateSheet(rateSheets ?? [])?.id ?? null;
  }

  return { bolDocumentIds, rateSheetId };
}
```

- [ ] **Step 7: Create worker/src/stages/post-audit.ts**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicChecks } from '@sifter/core/audit/deterministic-checks';
import { runAiAuditAgent } from '@sifter/core/audit/ai-audit-agent';
import { insertFindingsAndUpdateInvoice } from '@sifter/core/audit/post-audit-db';
import type { FindingDraft } from '@sifter/core/audit/types';
import type { CheckResult } from '@sifter/core/audit/deterministic-checks';

interface PostAuditInput {
  orgId: string;
  invoiceId: string;
  bolDocumentIds: string[];
  rateSheetId: string | null;
}

/**
 * Idempotent: skips if findings already exist for this invoiceId.
 */
export async function runPostAuditStage(
  supabase: SupabaseClient,
  { orgId, invoiceId, bolDocumentIds, rateSheetId }: PostAuditInput
): Promise<void> {
  // Idempotency check
  const { data: existingFindings } = await supabase
    .from('findings')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .limit(1);

  if (existingFindings && existingFindings.length > 0) return;

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, carrier_id, invoice_number, invoice_date, total_amount, created_at')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (invErr) throw new Error(`Failed to load invoice: ${invErr.message}`);

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('amount, description')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId);

  const lineItems = items ?? [];
  const lineSum = lineItems.reduce((s: number, item: { amount: number }) => s + (item.amount ?? 0), 0);
  const lineDescriptions = lineItems.map((item: { description: string }) => item.description ?? '');

  const deterministicResults = runDeterministicChecks({
    lineSum,
    totalAmount: inv.total_amount,
    invoiceDate: new Date(inv.invoice_date),
    receivedAt: new Date(inv.created_at),
    lineDescriptions,
    hasExistingClearedDuplicate: false,
    duplicateDelta: 0,
  });

  let rateSheetJson: unknown = null;
  let bolJson: unknown = null;

  if (rateSheetId) {
    const { data } = await supabase.from('rate_sheets').select('*').eq('id', rateSheetId).eq('org_id', orgId).single();
    rateSheetJson = data ?? null;
  }

  if (bolDocumentIds.length > 0) {
    const { data } = await supabase
      .from('documents')
      .select('id, ref_value, doc_type')
      .eq('org_id', orgId)
      .in('id', bolDocumentIds);
    bolJson = data ?? null;
  }

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
    invoiceJson: inv,
    rateSheetJson: rateSheetJson ?? undefined,
    bolJson: bolJson ?? undefined,
    deterministicFindings: detFindings,
  });

  await insertFindingsAndUpdateInvoice(supabase, orgId, invoiceId, findings);
}
```

- [ ] **Step 8: Typecheck worker stages**

```bash
cd worker
pnpm typecheck
```

Expected: no TypeScript errors. If `@sifter/core` imports fail, run `cd packages/core && pnpm build` first.

- [ ] **Step 9: Commit**

```bash
git add worker/
git commit -m "feat: add document pipeline stages to worker (ocr, classify, normalize, gather-context, post-audit)"
```

---

## Task 6: Worker Job Handlers

**Files:**
- Create: `worker/src/jobs/document-pipeline.ts`
- Create: `worker/src/jobs/gmail-sync.ts`
- Create: `worker/src/jobs/email-events.ts`

- [ ] **Step 1: Create worker/src/jobs/document-pipeline.ts**

This composes all 5 stages in sequence. It sets `processing_status` to `processing` at start and `audited` at end.

```ts
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import type { DocumentPipelinePayload } from '@sifter/core/queue/types';
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
  if (classifyResult.rejected) return; // status already set to 'rejected' by classify stage

  const invoiceId = await runNormalizeStage(supabase, db, { orgId, documentId, mongoDocId });

  const { bolDocumentIds, rateSheetId } = await runGatherContextStage(supabase, { orgId, invoiceId });

  await runPostAuditStage(supabase, { orgId, invoiceId, bolDocumentIds, rateSheetId });

  await supabase
    .from('documents')
    .update({ processing_status: 'audited', updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('org_id', orgId);
}
```

- [ ] **Step 2: Create worker/src/jobs/gmail-sync.ts**

Gmail sync job: enqueue follow-up work via `emailEventsQueue.add()` and `documentPipelineQueue.add()` from `processMessage` (no HTTP callback orchestration).

```ts
import { createHash } from 'crypto';
import { Storage } from '@google-cloud/storage';
import type { gmail_v1 } from 'googleapis';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { buildGmailClient, nextHistoryId } from '@sifter/core/email/gmail-poller';
import { decryptOAuthSecret } from '@sifter/core/server/oauth-token-crypto';
import { documentPipelineQueue, emailEventsQueue } from '@sifter/core/queue/index';

const EMAIL_BACKLOG_DAYS = Number(process.env.EMAIL_BACKLOG_DAYS ?? 60);

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return '';
}

function findPdfAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  const results: gmail_v1.Schema$MessagePart[] = [];
  if (payload.filename?.toLowerCase().endsWith('.pdf') && payload.body?.attachmentId) {
    results.push(payload);
  }
  for (const part of payload.parts ?? []) {
    results.push(...findPdfAttachments(part));
  }
  return results;
}

async function processMessage(
  gmail: Awaited<ReturnType<typeof buildGmailClient>>,
  orgId: string,
  messageId: string,
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<void> {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const headers = msg.data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

  const threadId = msg.data.threadId ?? messageId;
  const fromEmail = getHeader('from');
  const toEmails = getHeader('to').split(',').map((s) => s.trim()).filter(Boolean);
  const ccEmails = getHeader('cc').split(',').map((s) => s.trim()).filter(Boolean);
  const subject = getHeader('subject');
  const dateStr = getHeader('date');
  const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
  const body = extractBody(msg.data.payload);

  // Always enqueue email-events for dispute-reply matching
  await emailEventsQueue.add(`email-${messageId}`, {
    orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt,
  }, { jobId: `email-${messageId}` });

  const attachments = findPdfAttachments(msg.data.payload);
  if (attachments.length === 0) return;

  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_BUCKET!);

  for (const att of attachments) {
    if (!att.body?.attachmentId) continue;

    const attData = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: att.body.attachmentId,
    });

    const buf = Buffer.from(attData.data.data ?? '', 'base64url');
    const sha256 = createHash('sha256').update(buf).digest('hex');

    const { data: existing } = await supabase
      .from('documents')
      .select('id')
      .eq('org_id', orgId)
      .eq('sha256', sha256)
      .maybeSingle();

    if (existing) continue;

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

    await documentPipelineQueue.add(`doc-${doc.id}`, {
      orgId, documentId: doc.id, gcsKey, sourceType: 'email',
    }, { jobId: `doc-${doc.id}` });
  }
}

export async function handleGmailSync(): Promise<{ processed: number }> {
  const supabase = createServiceRoleClient();

  const { data: connections, error } = await supabase
    .from('email_connections')
    .select('id, org_id, last_history_id, oauth_tokens ( refresh_token_encrypted )')
    .eq('provider', 'gmail')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to fetch email connections: ${error.message}`);

  for (const connection of connections ?? []) {
    const { id: connectionId, org_id: orgId, last_history_id: lastHistoryId } = connection;
    const tokenRows = connection.oauth_tokens as unknown as { refresh_token_encrypted: string }[] | null;
    const encryptedToken = Array.isArray(tokenRows) ? tokenRows[0]?.refresh_token_encrypted : null;
    if (!encryptedToken) continue;

    const refreshToken = await decryptOAuthSecret(encryptedToken);
    const gmail = await buildGmailClient(refreshToken);
    let newHistoryId: string | null = null;

    if (!lastHistoryId) {
      const afterDate = new Date();
      afterDate.setDate(afterDate.getDate() - EMAIL_BACKLOG_DAYS);
      const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

      const listResp = await gmail.users.messages.list({
        userId: 'me',
        q: `after:${afterTimestamp} has:attachment filename:pdf`,
        maxResults: 500,
      });

      for (const msg of listResp.data.messages ?? []) {
        if (msg.id) await processMessage(gmail, orgId as string, msg.id, supabase);
      }

      const profile = await gmail.users.getProfile({ userId: 'me' });
      newHistoryId = profile.data.historyId ?? null;
    } else {
      const histResp = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId as string,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
      });

      newHistoryId = nextHistoryId({
        history: (histResp.data.history ?? []) as { id?: string }[],
      });

      for (const record of histResp.data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          if (added.message?.id) {
            await processMessage(gmail, orgId as string, added.message.id, supabase);
          }
        }
      }
    }

    if (newHistoryId) {
      await supabase
        .from('email_connections')
        .update({ last_history_id: newHistoryId, updated_at: new Date().toISOString() })
        .eq('id', connectionId);
    }
  }

  return { processed: (connections ?? []).length };
}
```

- [ ] **Step 3: Create worker/src/jobs/email-events.ts**

Inbound email / dispute matching: service-role Supabase client in the worker (no cookie/auth context).

```ts
import type { Job } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import type { EmailEventsPayload } from '@sifter/core/queue/types';

export function matchInboundEmailToDispute(
  disputes: Array<{ id: string; email_thread_id: string | null; status: string }>,
  threadId: string
): { id: string; email_thread_id: string | null; status: string } | null {
  return (
    disputes.find((d) => d.email_thread_id === threadId && d.status !== 'resolved') ?? null
  );
}

export async function handleEmailEvents(job: Job<EmailEventsPayload>): Promise<void> {
  const { orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt } =
    job.data;

  const supabase = createServiceRoleClient();

  const { data: disputes } = await supabase
    .from('disputes')
    .select('id, email_thread_id, status')
    .eq('org_id', orgId)
    .not('email_thread_id', 'is', null)
    .neq('status', 'resolved');

  const matched = matchInboundEmailToDispute(disputes ?? [], threadId);
  if (!matched) return;

  await supabase.from('dispute_messages').insert({
    org_id: orgId,
    dispute_id: matched.id,
    direction: 'inbound',
    from_email: fromEmail,
    to_emails: toEmails,
    cc_emails: ccEmails ?? [],
    subject,
    body,
    email_message_id: messageId,
    email_thread_id: threadId,
    sent_at: receivedAt,
  });

  await supabase
    .from('disputes')
    .update({ status: 'carrier_replied', updated_at: new Date().toISOString() })
    .eq('id', matched.id)
    .eq('org_id', orgId);

  // Create notification
  await supabase.from('notifications').insert({
    org_id: orgId,
    type: 'carrier_replied',
    reference_id: matched.id,
    message: 'Carrier replied to your dispute',
    read: false,
    created_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Typecheck worker jobs**

```bash
cd worker
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/jobs/
git commit -m "feat: add worker job handlers (document-pipeline, gmail-sync, email-events)"
```

---

## Task 7: Worker Entry Point (workers.ts, scaler.ts, board.ts, index.ts)

**Status (2026-03-28):** Done on branch `feature/worker-architecture`, commit `ac19e6f4`. **Deviation from snippet below:** `BullMQAdapter` must be imported from `@bull-board/api/bullMQAdapter` (not `.../bullMQAdapter.js`) for TypeScript + package `exports`. Failed-job logs use explicit queue name labels. **Next:** Task 8.

**Files:**
- Create: `worker/src/workers.ts`
- Create: `worker/src/scaler.ts`
- Create: `worker/src/board.ts`
- Create: `worker/src/index.ts`

- [x] **Step 1: Create worker/src/workers.ts**

```ts
import { Worker } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { getMongoDb } from '@sifter/core/mongodb/client';
import { getRedisConnection } from '@sifter/core/queue/index';
import { handleDocumentPipeline } from './jobs/document-pipeline.js';
import { handleGmailSync } from './jobs/gmail-sync.js';
import { handleEmailEvents } from './jobs/email-events.js';

export function createWorkers(): Worker[] {
  const connection = getRedisConnection();

  const documentWorker = new Worker(
    'document-pipeline',
    async (job) => {
      const supabase = createServiceRoleClient();
      const db = await getMongoDb();
      await handleDocumentPipeline(job, supabase, db);
    },
    { connection, concurrency: 3, lockDuration: 600_000 /* 10 min */ }
  );

  const gmailWorker = new Worker(
    'gmail-sync',
    async (_job) => {
      await handleGmailSync();
    },
    { connection, concurrency: 1 }
  );

  const emailWorker = new Worker(
    'email-events',
    async (job) => {
      await handleEmailEvents(job);
    },
    { connection, concurrency: 5 }
  );

  for (const worker of [documentWorker, gmailWorker, emailWorker]) {
    worker.on('failed', (job, err) => {
      console.error(`[${worker.name}] Job ${job?.id} failed:`, err.message);
    });
  }

  return [documentWorker, gmailWorker, emailWorker];
}
```

- [x] **Step 2: Create worker/src/scaler.ts**

```ts
const JOBS_PER_MACHINE = Number(process.env.JOBS_PER_MACHINE ?? 5);
const MIN_MACHINES = Number(process.env.MIN_MACHINES ?? 1);
const MAX_MACHINES = Number(process.env.MAX_MACHINES ?? 5);
const SCALE_INTERVAL_MS = 30_000;

interface FlyMachine {
  id: string;
  state: string;
}

async function flyRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const token = process.env.FLY_API_TOKEN;
  const app = process.env.FLY_APP_NAME;
  if (!token || !app) throw new Error('FLY_API_TOKEN and FLY_APP_NAME must be set');

  const res = await fetch(`https://api.machines.dev/v1/apps/${app}/machines${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error(`Fly API ${method} ${path}: ${res.status} ${await res.text()}`);
  return method === 'GET' ? res.json() : null;
}

async function getRunningMachines(): Promise<FlyMachine[]> {
  const machines = (await flyRequest('')) as FlyMachine[];
  return machines.filter((m) => m.state === 'started');
}

export function startAutoscaler(getQueueDepth: () => Promise<number>): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const depth = await getQueueDepth();
      const desired = Math.min(
        MAX_MACHINES,
        Math.max(MIN_MACHINES, Math.ceil(depth / JOBS_PER_MACHINE))
      );

      const running = await getRunningMachines();
      const runningCount = running.length;

      if (desired > runningCount) {
        const toStart = desired - runningCount;
        console.log(`[scaler] depth=${depth}, starting ${toStart} machine(s)`);
        for (let i = 0; i < toStart; i++) {
          await flyRequest('', 'POST', { config: {} }); // clone default config
        }
      } else if (desired < runningCount) {
        const toStop = runningCount - desired;
        console.log(`[scaler] depth=${depth}, stopping ${toStop} machine(s)`);
        const idle = running.slice(runningCount - toStop);
        for (const m of idle) {
          await flyRequest(`/${m.id}/stop`, 'POST');
        }
      }
    } catch (err) {
      console.error('[scaler] Error:', (err as Error).message);
    }
  }, SCALE_INTERVAL_MS);
}
```

- [x] **Step 3: Create worker/src/board.ts**

```ts
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { documentPipelineQueue, gmailSyncQueue, emailEventsQueue } from '@sifter/core/queue/index';

export function startBullBoard(): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');

  createBullBoard({
    queues: [
      new BullMQAdapter(documentPipelineQueue),
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

- [x] **Step 4: Create worker/src/index.ts**

```ts
import 'dotenv/config';
import { gmailSyncQueue, documentPipelineQueue, emailEventsQueue } from '@sifter/core/queue/index';
import { createWorkers } from './workers.js';
import { startAutoscaler } from './scaler.js';
import { startBullBoard } from './board.js';

async function main() {
  console.log('[worker] Starting sifter-worker...');

  // Register Gmail sync as a repeatable job (idempotent — BullMQ deduplicates by jobId)
  await gmailSyncQueue.add('sync-all', {}, {
    repeat: { pattern: '*/15 * * * *' },
    jobId: 'gmail-sync-cron',
  });

  // Start BullMQ workers
  const workers = createWorkers();
  console.log(`[worker] ${workers.length} workers started`);

  // Start autoscaler
  const getQueueDepth = async () => {
    const counts = await Promise.all([
      documentPipelineQueue.getJobCounts('waiting', 'active'),
      gmailSyncQueue.getJobCounts('waiting', 'active'),
      emailEventsQueue.getJobCounts('waiting', 'active'),
    ]);
    return counts.reduce((sum, c) => sum + (c.waiting ?? 0) + (c.active ?? 0), 0);
  };

  startAutoscaler(getQueueDepth);

  // Start internal Bull Board dashboard
  startBullBoard();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM received, draining workers...');
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });

  console.log('[worker] Ready.');
}

main().catch((err) => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
```

- [x] **Step 5: Typecheck the full worker**

```bash
cd worker
pnpm typecheck
```

Expected: no TypeScript errors. Fix any import path issues (add `.js` extensions for NodeNext resolution if needed).

- [x] **Step 6: Commit**

```bash
git add worker/src/workers.ts worker/src/scaler.ts worker/src/board.ts worker/src/index.ts
git commit -m "feat: add worker orchestration entry point with autoscaler and Bull Board"
```

---

## Task 8: Update Next.js API Routes to Enqueue via BullMQ

**Files:**
- Modify: `app/api/documents/upload/route.ts`

- [ ] **Step 1: Update app/api/documents/upload/route.ts**

Use:

```ts
import { documentPipelineQueue } from '@sifter/core/queue/index';
```

After the document row is inserted, enqueue:

```ts
await documentPipelineQueue.add(`doc-${id}`, {
  orgId: ctx.orgId,
  documentId: id,
  gcsKey,
  sourceType: 'upload',
}, { jobId: `doc-${id}` });
```

(Adjust queue name / payload field names to match `packages/core/src/queue/types.ts`.)

- [ ] **Step 2: Verify Next.js build still passes**

```bash
pnpm build
```

Expected: no errors. The `@sifter/core` import resolves via workspace + transpilePackages.

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/upload/route.ts
git commit -m "feat: enqueue document pipeline from upload route via BullMQ"
```

---

## Task 9: Fly.io Deployment Files

**Files:**
- Create: `worker/Dockerfile`
- Create: `worker/fly.toml`

- [ ] **Step 1: Create worker/Dockerfile**

```dockerfile
# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --filter sifter-worker...

# Stage 2: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/worker/node_modules ./worker/node_modules
COPY packages/core ./packages/core
COPY worker ./worker
RUN cd packages/core && node_modules/.bin/tsc
RUN cd worker && node_modules/.bin/tsc

# Stage 3: Production image
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter sifter-worker...
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/worker/dist ./worker/dist
WORKDIR /app/worker
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create worker/fly.toml**

```toml
app            = "sifter-worker"
primary_region = "sjc"

[build]
  dockerfile = "worker/Dockerfile"

[[vm]]
  size   = "shared-cpu-1x"
  memory = "512mb"

[env]
  NODE_ENV = "production"

# No [http_service] — pure worker, no public HTTP
```

- [ ] **Step 3: Commit**

```bash
git add worker/Dockerfile worker/fly.toml
git commit -m "feat: add Fly.io Dockerfile and fly.toml for sifter-worker"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered |
|---|---|
| §2 Solution — BullMQ + Upstash + Fly.io | ✅ Tasks 1, 4, 7, 9 |
| §3 Monorepo structure with pnpm workspaces | ✅ Tasks 1, 2, 3 |
| §4 Queue topology (3 queues, payloads, concurrency) | ✅ Tasks 4, 7 |
| §5 Document pipeline stages (idempotent) | ✅ Task 5 |
| §5 processing_status vocabulary (rejected not failed) | ✅ classify.ts sets 'rejected' |
| §6 Worker entry point startup sequence | ✅ Task 7 (index.ts) |
| §7 Autoscaler with Fly.io Machines API | ✅ Task 7 (scaler.ts) |
| §8 Fly.io Dockerfile + fly.toml | ✅ Task 9 |
| §9 Bull Board observability on :9999 | ✅ Task 7 (board.ts) |
| §10 Adoption checklist | ✅ Tasks 1–9 |
| §11 Env vars documented | ✅ fly.toml + code uses process.env |

**No placeholders found.**

**Type consistency:** `DocumentPipelinePayload` defined in `packages/core/src/queue/types.ts`, used identically in `worker/src/jobs/document-pipeline.ts` and `app/api/documents/upload/route.ts`. `handleDocumentPipeline(job, supabase, db)` signature consistent between `workers.ts` and `document-pipeline.ts`.

---

## QA agent checklist (implement / verify after merge & deploy)

Use this section for staging or production acceptance. **Superpowers:** `verification-before-completion` — record command output or dashboard screenshots before marking pass.

### A. Repository & CI (no running services)

1. **Producers** — API routes that start the pipeline use `@sifter/core` queue helpers (e.g. `documentPipelineQueue.add` on upload). No long-running OCR/LLM work in route handlers.

2. **Unit tests** — From Next.js app root (worktree):

   ```bash
   cd packages/core && pnpm build && cd ../.. && pnpm test && pnpm build
   ```

   Expected: all tests pass (audit + email-match tests under `__tests__/audit` and `__tests__/worker`).

3. **Docker worker image** — From monorepo root:

   ```bash
   docker build -f worker/Dockerfile -t sifter-worker:local .
   ```

### B. Hosting & secrets

4. **Vercel (Next.js)** — **Required:** `UPSTASH_REDIS_URL` (and existing Supabase/GCS keys) so `documentPipelineQueue.add` resolves to Redis.

### C. Runtime (staging or production)

5. **Fly worker** — Machine(s) running latest image; logs show startup, BullMQ workers, repeatable Gmail job registered (`worker/src/index.ts`).

6. **Upload → pipeline** — Upload a PDF (or `POST /api/documents/upload` with auth). Confirm: row in `documents`; a job on queue `document-pipeline` (Bull Board on port **9999** via `fly proxy 9999`, or Redis/Bull inspection tool).

7. **Job completion** — Worker logs show stages running (or a deliberate `rejected` for non-freight). No timeouts attributable to Vercel function limits for pipeline work.

8. **Gmail / email** — After a sync or inbound message path, jobs appear on `gmail-sync` or `email-events` and complete; notifications rows match schema (`title`, `body`, `invoice_id`, `user_id`, …).

### D. Optional monitoring

9. **Queue depth** — Under load, autoscaler (if `FLY_API_TOKEN` + `FLY_APP_NAME` set) adjusts machines; no unbounded Redis growth without consumers.

**Failure handling:** If any check fails, capture logs (Vercel function, Fly `fly logs`, Redis/Bull) and whether `UPSTASH_REDIS_URL` matches between Vercel and Fly.
