# Worker architecture — handover for the next agent

Instructions for the BullMQ + Upstash Redis + Fly.io worker migration (Inngest replacement). **Implementation tasks 1–10 are complete** on `feature/worker-architecture`. **Next owner:** a **QA / acceptance agent** should execute the checklist in this file ([QA agent — production & staging acceptance](#qa-agent--production--staging-acceptance)) and in the plan § **QA agent checklist**.

---

## Memory folder (Claude Code project memory)

Absolute path on this machine:

`/Users/vanhtran18/.claude/projects/-Users-vanhtran18-Documents-Sifter-sifter-recode/memory/`

### Files to read first

| File | Purpose |
|------|---------|
| `MEMORY.md` | Index and links to other memory docs |
| `project-worker-implementation.md` | Task status, commits, execution notes |
| `project-worker-deployment.md` | Architecture decisions (BullMQ, Fly.io, queue topology) |
| `project-sifter-design.md` | Product context |
| `feedback-bash-bulk-operations.md` | Prefer bash scripts for multi-file operations |

---

## Plan file (source of truth for implementation + QA)

`docs/superpowers/plans/2026-03-28-worker-architecture.md` — includes **§ QA agent checklist** at the end of the document.

Design background: `docs/superpowers/specs/2026-03-28-worker-architecture-design.md`

---

## Worktree and branch

- **Worktree:** `.worktrees/worker-architecture` (under the `sifter-recode` repo)
- **Branch:** `feature/worker-architecture`

Verify HEAD after any merge/rebase:

```bash
cd .worktrees/worker-architecture
git log --oneline -10
```

**Latest migration commits (representative):** Task 10 (remove Inngest) — **`98d4d709`**; prior: upload → BullMQ, Fly files, lazy queues, tests (see `project-worker-implementation.md`).

---

## Task status

| # | Task | Status | Notes / commit |
|---|------|--------|----------------|
| 1 | pnpm workspace + `@sifter/core` scaffold | Done | 2d1349c8–1366a77c |
| 2 | Move `lib/` → `packages/core/src/` | Done | 18a5f1f5 |
| 3 | Wire `@sifter/core` into Next.js | Done | 710b1789 |
| 4 | BullMQ queue definitions in `@sifter/core` | Done | 011f7963 |
| 5 | Worker stages (ocr, classify, normalize, gather-context, post-audit) | Done | 555de0b4 |
| 5b | Document pipeline job file (`document-pipeline.ts`) | Done | f9696057 |
| 6 | Job handlers (document-pipeline, gmail-sync, email-events) | Done | c36de619 |
| 7 | Worker entry (`workers.ts`, `scaler.ts`, `board.ts`, `index.ts`) | Done | ac19e6f4 |
| 8 | Swap upload route to BullMQ | Done | `465a74c6` (+ lazy queues); upload test mock `707ec29a` |
| 9 | Fly.io `Dockerfile` + `fly.toml` | Done | `bab22cf3` |
| 10 | Remove Inngest | Done | **`98d4d709`** — deleted `lib/inngest/`, `app/api/inngest/route.ts`, dep removed; tests → `__tests__/audit`, `__tests__/worker`; `packages/core/dist/` gitignored |

**Next step:** QA / acceptance (checklist below + plan file). Merge `feature/worker-architecture` to main when green.

---

## QA agent — production & staging acceptance

**Goal:** Confirm no reliance on Inngest, Next.js enqueues only via BullMQ, and the Fly worker drains queues end-to-end.

**Superpowers:** use `verification-before-completion` — do not mark pass without command output or observable proof.

### 1. Repo / CI (local)

From **worktree root** `.worktrees/worker-architecture`:

```bash
grep -rE 'inngest|INNGEST' app lib __tests__ --include='*.ts' --include='*.tsx' || true
```

Expected: **no output**.

```bash
cd packages/core && pnpm build && cd ../.. && pnpm test && pnpm build
```

Expected: **`pnpm test` — 106** tests; **`pnpm build`** succeeds.

```bash
docker build -f worker/Dockerfile -t sifter-worker:local .
```

Expected: image builds.

### 2. Platform config

- **Vercel:** `UPSTASH_REDIS_URL` set for the Next.js deployment. Remove unused `INNGEST_*` variables.
- **Inngest dashboard:** Remove or disable sync to `/api/inngest` (route deleted).
- **Fly:** Worker app deployed with same Redis URL, GCS, Supabase service role, and other env vars required by `worker/src/index.ts`.

### 3. Functional smoke

- **Upload:** Authenticated PDF upload → document row + job on `document-pipeline` (verify via Bull Board on **:9999** with `fly proxy`, or your Redis inspector).
- **Worker logs:** Stages run to completion or expected `rejected` for non-freight.
- **Gmail / email paths:** Jobs on `gmail-sync` / `email-events`; notifications use DB columns `title`, `body`, `invoice_id`, `user_id`, etc.

### 4. Full detail

See **`docs/superpowers/plans/2026-03-28-worker-architecture.md`** → section **QA agent checklist** for numbered items A–D (autoscaler, monitoring, failure notes).

---

## Parallel subagents (historical — Task 8 + 9)

Tasks 8 and 9 were executed in parallel with **superpowers:dispatching-parallel-agents**. Pattern remains valid for future unrelated file splits.

| Subagent | Task | Scope (only these paths) |
|----------|------|---------------------------|
| **A** | 8 | `app/api/documents/upload/route.ts` |
| **B** | 9 | `worker/Dockerfile`, `worker/fly.toml` |

---

## Task 9 handover (Fly.io Dockerfile + fly.toml) — reference

Deploy from **pnpm workspace root** so Docker context includes `packages/core` and `worker`:

```bash
docker build -f worker/Dockerfile -t sifter-worker:local .
fly deploy . --config worker/fly.toml
```

See comments at top of `worker/fly.toml`.

---

## Decisions and constraints — do not undo

- **`packages/core`** uses **`module: NodeNext`**. **Inside** `packages/core/src`, relative imports end with **`.js`**. **Outside** (e.g. the worker), import **`@sifter/core/...` subpaths without a `.js` suffix** — `package.json` `exports` already map e.g. `queue/types` → `dist/queue/types.js`; using `@sifter/core/queue/types.js` breaks resolution.
- **`pdf-parse`**: use **`createRequire`** (CJS-only), not dynamic `import`.
- **`oauth-token-crypto.ts`**: decrypt with **`Buffer.from(result.plaintext!)`** (KMS returns `Uint8Array`, not `Buffer`).
- **Queue exports** from `@sifter/core` are enabled. Payload types: `packages/core/src/queue/types.ts` — **`GmailSyncPayload`** is empty (`Record<string, never>`); **`EmailEventsPayload`** uses camelCase fields per the plan.
- **`openai`** is a **worker** dependency (classify stage instantiates the client). **`googleapis`** is on the worker for Gmail types in `gmail-sync`.
- **`email-events` → `notifications`:** The DB expects **`title`**, **`body`**, **`invoice_id`**, **`user_id`**, **`read`**, **`created_at`**. The worker fans out one row per **active `membership`** for the org so `GET /api/notifications` (filtered by `user_id`) works.
- **Bull Board (Task 7):** Import **`BullMQAdapter` from `@bull-board/api/bullMQAdapter`** (no `.js` suffix).

---

## Verification commands

From the **worktree root**:

```bash
cd .worktrees/worker-architecture
pnpm test
```

Expected: **106** tests passing.

```bash
cd worker && pnpm typecheck
```

After changes to `packages/core` source:

```bash
cd packages/core && pnpm build
```

(`packages/core/dist/` is gitignored; CI and local test runs should build core before `pnpm test` if resolution depends on `dist`.)

---

## Updating this doc

When QA finishes, update **`memory/project-worker-implementation.md`** with environment (staging/prod), date, and any failures. Keep this handover and the plan § QA checklist in sync.
