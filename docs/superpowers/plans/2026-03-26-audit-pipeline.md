# Audit Pipeline (Backend) Implementation Plan

> **For agentic workers:** Use [2026-03-28-worker-architecture.md](./2026-03-28-worker-architecture.md) and the design spec [2026-03-28-worker-architecture-design.md](../specs/2026-03-28-worker-architecture-design.md) as the **source of truth** for queues, worker stages, env vars, and numbered tasks.

> This file previously contained a long, step-by-step backend plan tied to an older orchestration approach. That content was removed; the pipeline is implemented as **BullMQ jobs** on **Upstash Redis**, executed by the **Fly.io worker**, with shared logic in **`packages/core`** (`@sifter/core`).

**Goal:** End-to-end automated ingestion, OCR, classification, LLM normalization, deterministic + AI auditing, and email/manual intake so invoices move from raw documents to `findings` + correct `invoices.ui_status` in Supabase.

**Architecture:** The Next.js app enqueues jobs; the worker runs OCR → classify → normalize → gather context → deterministic checks → AI audit → post-audit. Raw PDFs live in GCS; OCR intermediates in MongoDB; structured data in Postgres via a **service-role** Supabase client in the worker. Pure business logic lives in `@sifter/core` so Vitest can cover it without running the worker process.

**Tech Stack:** Next.js 16 (App Router), BullMQ + Upstash Redis, Fly.io worker, `@sifter/core`, Supabase JS (service role), `@google-cloud/storage`, `mongodb`, OpenAI SDK (`openai`), `googleapis` (Gmail), Vitest, pnpm.

---

## Where to look

| Area | Location |
|------|----------|
| Queue definitions & job payloads | `packages/core/src/queue/` |
| Document pipeline orchestration | `worker/src/jobs/document-pipeline.ts`, `worker/src/stages/` |
| Gmail sync & inbound email jobs | `worker/src/jobs/gmail-sync.ts`, `worker/src/jobs/email-events.ts` |
| Post-audit DB writes | `packages/core/src/audit/post-audit-db.ts` |
| Upload → enqueue | `app/api/documents/upload/route.ts` |

Use the **worker architecture plan** for the full task list, commits, and QA checklist.
