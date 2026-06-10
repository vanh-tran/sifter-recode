# Worker Architecture Design

**Date:** 2026-03-28
**Status:** Approved

---

## 1. Problem

Background processing (document OCR, AI classification, invoice normalization, Gmail sync) must not run inside short-lived Vercel serverless invocations. Those functions have a hard execution timeout (60s on Pro, 300s with Fluid compute). Long-running tasks — OCR on large PDFs, multi-step AI pipelines, Gmail backfills covering 500+ messages — need a persistent worker process.

---

## 2. Solution

Use a **BullMQ + Upstash Redis + Fly.io worker** architecture.

- **Vercel** handles only the web app and API routes. It enqueues jobs; it never runs them.
- **Upstash Redis** stores job queues (pay-per-command, zero idle cost).
- **Fly.io** runs a persistent Node.js worker process that polls Redis and processes jobs without any timeout constraint.
- **No dispatcher, no callbacks, no orchestration protocol.** The worker owns its execution end-to-end.

---

## 3. Monorepo Structure

The repo adopts **pnpm workspaces** so the worker and Next.js app have isolated dependency trees and independent deployments. The Fly.io image never contains Next.js or React code.

```
sifter-recode/
├── app/                        # Next.js app directory
├── packages/
│   └── core/                   # Shared business logic (moved from lib/)
│       ├── src/
│       │   ├── supabase/
│       │   ├── mongodb/
│       │   ├── gcs/
│       │   ├── email/
│       │   ├── llm/
│       │   ├── audit/
│       │   ├── ocr/
│       │   ├── queue/          # BullMQ queue definitions + job payload types
│       │   └── server/
│       ├── package.json        # name: "@sifter/core"
│       └── tsconfig.json
├── worker/                     # Fly.io worker app
│   ├── src/
│   │   ├── stages/             # Idempotent stage functions
│   │   │   ├── ocr.ts
│   │   │   ├── classify.ts
│   │   │   ├── normalize.ts
│   │   │   ├── gather-context.ts
│   │   │   └── post-audit.ts
│   │   ├── jobs/
│   │   │   ├── document-pipeline.ts   # Composes stages in sequence
│   │   │   ├── gmail-sync.ts          # Gmail polling (replaces gmail-sync-cron)
│   │   │   └── email-events.ts        # Inbound email / dispute matching
│   │   ├── scaler.ts           # Queue-depth autoscaler (Fly.io Machines API)
│   │   ├── workers.ts          # BullMQ Worker instances + concurrency config
│   │   └── index.ts            # Entry point
│   ├── Dockerfile
│   ├── fly.toml
│   ├── package.json            # name: "sifter-worker", depends on @sifter/core
│   └── tsconfig.json
├── next.config.ts
├── package.json                # name: "sifter-web" (Next.js)
├── pnpm-workspace.yaml
└── tsconfig.json
```

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
  - 'worker'
```

**Import alias change:**
All `@/lib/...` imports across the Next.js app and tests are updated to `@sifter/core/...` as part of the migration. 179 references across 73 files — one find-replace pass.

---

## 4. Queue Topology

Three queues served from a single Upstash Redis instance.

### `document-pipeline`

| Property | Value |
|---|---|
| Trigger | Next.js API enqueues when a document is created |
| Payload | `{ orgId, documentId, gcsKey, sourceType }` |
| Concurrency | 3 per worker machine |
| Retries | 3 attempts, exponential backoff (5s → 25s → 125s) |
| Timeout | 10 minutes per job |

Worker runs the full chain: OCR → classify → normalize → gather-context → post-audit.
Non-freight documents exit cleanly after classify with `processing_status = 'rejected'` — this is not an error and does not consume a retry.

### `gmail-sync`

| Property | Value |
|---|---|
| Trigger | BullMQ repeatable job, registered on worker startup |
| Schedule | `*/15 * * * *` |
| Payload | `{}` (syncs all active connections) |
| Concurrency | 1 (no parallel syncs) |
| Retries | 3 attempts |

On completion, enqueues one `document-pipeline` job and one `email-events` job per new item found.

### `email-events`

| Property | Value |
|---|---|
| Trigger | Enqueued by `gmail-sync` for every new email (with or without attachments) |
| Payload | `{ orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt }` |
| Concurrency | 5 per worker machine |
| Retries | 3 attempts |

Worker matches email thread to open disputes, appends message, updates dispute status, creates notification. Lightweight — most jobs complete in under 1 second.

---

## 5. Document Pipeline Stages

Each stage is an **idempotent function**: it checks whether its work is already done before executing. This makes the entire pipeline safe to retry from the start without redundant API calls or duplicate data.

```
document-pipeline job
  │
  ├─ runOcrStage()           checks: documents.mongodb_document_id IS NULL
  │                          does:   download PDF from GCS, run OCR, store text in MongoDB,
  │                                  update documents.mongodb_document_id
  │
  ├─ runClassifyStage()      checks: documents.document_type IS NULL
  │                          does:   load OCR text from MongoDB, call GPT-4o to classify
  │                          exit:   if not FREIGHT_INVOICE → set status='rejected', return
  │
  ├─ runNormalizeStage()     checks: invoices row exists for this document_id
  │                          does:   extract structured fields, create invoice + line_items rows
  │
  ├─ runGatherContextStage() checks: invoice.context_ready = true
  │                          does:   match rate sheet and BOL documents, link to invoice
  │
  └─ runPostAuditStage()     checks: findings rows exist for this invoice_id
                             does:   run deterministic checks + AI audit agent,
                                     persist findings, set status='audited'
```

### Processing status vocabulary

| Status | Meaning |
|---|---|
| `pending` | Document received, pipeline not yet started |
| `processing` | Pipeline is running |
| `rejected` | Document is not a freight invoice — intentional exit, no action needed |
| `failed` | Unexpected error after exhausting all retries — needs investigation |
| `audited` | Full pipeline completed successfully |

---

## 6. Worker Entry Point

`worker/src/index.ts` does three things on startup:

1. Registers the Gmail sync repeatable job (idempotent — BullMQ deduplicates by `jobId`):
   ```ts
   await gmailSyncQueue.add('sync-all', {}, {
     repeat: { pattern: '*/15 * * * *' },
     jobId: 'gmail-sync-cron'
   });
   ```
2. Starts all three BullMQ workers with concurrency config (`workers.ts`).
3. Starts the autoscaler loop (`scaler.ts`).

The process never exits. It is not an HTTP server — no port binding, no health check endpoint needed.

---

## 7. Autoscaling

The scaler runs as a `setInterval` loop inside the worker process. It checks queue depth every 30 seconds and calls the Fly.io Machines API to start or stop machines accordingly.

```
queue depth = waiting + active jobs across all queues

desired machines = clamp(
  ceil(depth / JOBS_PER_MACHINE),   // e.g. JOBS_PER_MACHINE = 5
  MIN_MACHINES,                      // always at least 1
  MAX_MACHINES                       // e.g. 5
)

if desired > running  → start (desired - running) new machines via Fly API
if desired < running  → stop idle machines (drain active jobs first)
```

**Fly.io Machines API calls:**
- Scale up: `POST https://api.machines.dev/v1/apps/sifter-worker/machines` (clone from existing machine config)
- Scale down: `POST .../machines/{id}/stop` (only machines with no active jobs)
- Inspect: `GET .../machines` (list running machines and their state)

The scaler requires `FLY_API_TOKEN` and `FLY_APP_NAME` env vars on the worker.

---

## 8. Fly.io Deployment

**`worker/fly.toml`:**
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

# No [http_service] — pure worker, no HTTP
```

**`worker/Dockerfile`** (multi-stage, lean image):
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --filter sifter-worker...

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/core ./packages/core
COPY worker ./worker
RUN pnpm --filter sifter-worker build

FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY worker/package.json ./worker/
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter sifter-worker...
COPY --from=build /app/worker/dist ./dist
CMD ["node", "dist/index.js"]
```

The Next.js app (`app/`, React, UI components) never enters the image.

---

## 9. Observability

**Bull Board** is mounted as a lightweight Express endpoint on a separate internal port (not publicly exposed). It provides a real-time view of job queues: waiting, active, completed, failed, delayed.

```ts
// worker/src/board.ts — internal only, not exposed via fly.toml
const app = express();
createBullBoard({ queues: [...], serverAdapter });
app.listen(9999);
```

Access via `fly proxy 9999` from a developer's machine — never public-facing.

**Supabase `processing_status`** gives product-level visibility: the dashboard can show document pipeline state without touching Redis.

**Sentry** (optional, recommended before go-live): wrap each job handler in a try/catch that reports to Sentry on final failure (after retries exhausted).

---

## 10. Adoption checklist

1. Set up Upstash Redis, get `UPSTASH_REDIS_URL`
2. Add `pnpm-workspace.yaml`, scaffold `packages/core/`
3. Move shared `lib/` modules into `packages/core/src/` where appropriate, re-export via `@sifter/core`
4. Add `packages/core/queue/` with BullMQ queue definitions and job payload types
5. Build out `worker/src/` — stages, job handlers, workers, scaler, index
6. Ensure Next.js API routes enqueue work with `queue.add(...)` (not inline long-running pipeline code)
7. Deploy worker to Fly.io, verify queues drain correctly

---

## 11. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `UPSTASH_REDIS_URL` | Vercel + Fly.io | BullMQ connection |
| `SUPABASE_URL` | Vercel + Fly.io | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Fly.io only | Worker uses service role |
| `MONGODB_URI` | Fly.io | OCR text storage |
| `GCS_BUCKET` | Fly.io | PDF storage |
| `GOOGLE_APPLICATION_CREDENTIALS` | Fly.io | GCS auth |
| `OPENAI_API_KEY` | Fly.io | Classification + audit |
| `FLY_API_TOKEN` | Fly.io | Autoscaler Machines API |
| `FLY_APP_NAME` | Fly.io | Autoscaler target app |
| `GMAIL_CLIENT_ID / SECRET` | Fly.io | Gmail OAuth |
| `OAUTH_ENCRYPTION_KEY` | Fly.io | Decrypt stored refresh tokens |
