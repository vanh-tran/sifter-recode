# CI/CD Pipeline & Testing Strategy — Sifter

**Date:** 2026-03-30
**Status:** Approved
**Scope:** Main Next.js app (Vercel) + BullMQ worker (Fly.io)

---

## Core Principles

- **Small, incremental changes** — target ≤200 lines per PR; break large features into stacked diffs
- **Automate everything possible** — lint, static analysis, tests, and security scans run before/after review; humans focus on architecture, design decisions, and edge cases
- **Static analysis over manual checks** — ESLint + TypeScript catch the class of bugs that manual review misses at scale
- **Separate app and worker pipelines** — except for shared API + integration tests, which run in both

---

## 1. Testing Layers

Four layers, each with a distinct purpose and tool:

| Layer | What it tests | Tooling | When it runs |
|---|---|---|---|
| **Static analysis** | ESLint rules, TypeScript type errors, OWASP-adjacent patterns | ESLint (existing) + `tsc --noEmit` | Pre-commit + every CI job |
| **Unit tests** | Pure functions, business logic, state machines in isolation | Vitest (existing, `__tests__/`) | Every PR |
| **Integration tests** | API routes + Supabase DB + auth against a real database | Vitest + Supabase local CLI | Every PR (shared job) |
| **E2E tests** | Critical user paths across the full deployed stack | Playwright | On merge to `main`, against Vercel preview URL |

### Test file locations

```
__tests__/              # existing unit + API tests (mock-heavy, stays as-is)
__tests__/integration/  # NEW — integration tests using Supabase local CLI
__tests__/worker/       # worker unit tests (mock queues + DB, no Supabase local)
e2e/                    # NEW — Playwright E2E suites
```

### Integration tests

Integration tests boot Supabase local CLI (`supabase start`) in CI, run `supabase db reset` for a clean slate, then run Vitest against the real Postgres + Auth + RLS stack. This mirrors production Supabase behavior (RLS policies, auth helpers) without consuming hosted project quota — local CLI runs entirely in Docker on the CI runner and does not count against the Supabase free-plan 2-project limit.

### Worker unit tests

Worker tests (`__tests__/worker/`) remain in the unit layer. They mock BullMQ queues and Supabase DB — no Supabase local CLI needed. This keeps worker CI fast and independent.

### Coverage targets (enforced via Vitest `--coverage`)

- Business logic + critical path functions: **70–80%**
- Worker job processors: **80%+** (hard to debug in production)
- UI components: **not enforced** — Playwright covers critical paths instead

---

## 2. Workflow Structure

Three GitHub Actions workflow files. App and worker are triggered independently by path filters; deploy only runs on `main`.

### `ci-app.yml` — triggered on PRs

**Path filter:** `app/**`, `lib/**`, `packages/**`, `__tests__/**` (excluding `__tests__/worker/`)

```
lint + typecheck → unit tests → integration tests (Supabase local) → pnpm audit
```

Steps:
1. `eslint` across app + lib
2. `tsc --noEmit`
3. `vitest run` (unit tests, excludes `__tests__/integration/` and `__tests__/worker/`)
4. `supabase start` → `supabase db reset` → `vitest run --project integration`
5. `pnpm audit --audit-level=high`

### `ci-worker.yml` — triggered on PRs

**Path filter:** `worker/**`, `__tests__/worker/**`, `lib/inngest/**`

```
lint + typecheck → worker unit tests → integration tests (Supabase local) → Docker build
```

Steps:
1. `eslint` across worker + shared lib
2. `tsc --noEmit` (worker tsconfig)
3. `vitest run --project worker`
4. `supabase start` → `supabase db reset` → `vitest run --project integration`
5. `docker build` (validates the image builds cleanly; no push on PRs)

### `deploy.yml` — triggered on push to `main`

App and worker deploy jobs run **in parallel**.

**App job:**
1. `vercel build --prod`
2. `vercel deploy --prebuilt --prod`
3. Upload sourcemaps to Sentry + create Sentry release tagged with git SHA
4. Run Playwright E2E suite against the new production URL

**Worker job:**
1. `docker build` worker image
2. Push to GitHub Container Registry (GHCR, free)
3. `fly deploy` using `FLY_API_TOKEN` secret

**Security job (runs after both deploy jobs pass):**
- Snyk SAST scan — blocks on high-severity findings

### Pre-commit hooks (local, via Husky + lint-staged)

Runs on staged files only — fast enough to not block commit flow:
```
staged .ts/.tsx files → eslint --fix → tsc --noEmit (project refs)
```

Catches lint and type errors before they reach CI.

---

## 3. E2E Tests (Playwright)

E2E lives in `e2e/` at the repo root, separate from `__tests__/`. Playwright targets Vercel preview URLs — every PR gets a preview deploy automatically, so E2E has a real deployed target without extra infra.

E2E runs in `deploy.yml` after the Vercel deploy step, **not** in `ci-app.yml`. This keeps PR feedback fast (lint + unit + integration is sufficient to block a merge) while E2E validates the actual deployed build.

### Critical path suites (day one)

| Suite | Happy path | Edge cases |
|---|---|---|
| **Auth flow** | Sign up → email verify → org setup (onboarding wizard) | Invalid email, duplicate org name |
| **Invoice upload → audit** | Upload PDF → findings appear → select findings | Upload non-PDF, upload corrupted file |
| **Dispute flow** | Generate dispute letter → download PDF | Attempt to generate with no findings selected |

Rule: very few E2E tests, high value per test. Each suite covers the happy path + 1–2 edge cases. No exhaustive permutation testing in E2E — that belongs in unit/integration.

---

## 4. Security Scanning

### Day one (on merge to `main`)
- **Dependabot** — auto-PRs for dependency CVEs, configured via `.github/dependabot.yml` (npm ecosystem, weekly cadence)
- **`pnpm audit`** — runs in both `ci-app.yml` and `ci-worker.yml` on every PR, fails on high-severity

### Phase 2 (add after initial pipeline is stable)
- **Snyk free tier** — SAST scan in `deploy.yml`, blocks deploy on high-severity findings
- **Trivy** — container image scan of the worker Docker image, runs alongside Snyk in `deploy.yml`

### Deferred
- OWASP ZAP dynamic scanning — add when the worker exposes a public HTTP surface worth scanning

---

## 5. Sentry Setup

### Next.js app
- Install `@sentry/nextjs`
- Instrument via `instrumentation.ts` (App Router pattern) + client-side wrapper
- `SENTRY_ENVIRONMENT=preview` on Vercel preview deploys, `production` on main
- Sourcemaps uploaded and Sentry release created in `deploy.yml` after production deploy, tagged with git SHA

### Worker
- Install `@sentry/node`
- Wrap BullMQ job processors with Sentry error capture
- Sentry release created alongside app release in `deploy.yml`

---

## 6. Observability Stack

All free tiers, zero additional infrastructure:

| Concern | Tool | Notes |
|---|---|---|
| **Errors + traces** | Sentry | App + worker, linked to git SHA |
| **Frontend analytics** | Vercel Analytics | Zero config, already available |
| **Worker logs** | Fly.io log drain → Logtail (free tier) | Structured JSON stdout from BullMQ processors |

---

## 7. Rollback Strategy

- **App (Vercel):** one-click instant rollback in the Vercel dashboard — no extra work needed
- **Worker (Fly.io):** `fly releases rollback <version>` from the CLI

No canary release infrastructure at this stage.

---

## 8. Deferred (Out of Scope)

Explicitly not in this implementation. Revisit when the project reaches the relevant scale:

- **Feature flags** (LaunchDarkly / Unleash) — add when concurrent users justify dark launches
- **Performance / load tests** — add when staging has production-like data
- **Nightly E2E on staging** — add when a persistent staging environment exists separate from Vercel previews
- **OWASP ZAP** — add when the worker has a public HTTP surface
- **Trivy** — add alongside Snyk once the worker image is stable in production
- **Canary releases** — add when traffic volume justifies gradual rollouts

---

## 9. Quick-Start Order

Implementation should follow this sequence, each as its own ≤200-line PR:

1. **Husky + lint-staged** — pre-commit hooks for ESLint + tsc
2. **`ci-app.yml`** — lint + typecheck + unit tests
3. **`ci-worker.yml`** — lint + typecheck + worker unit tests
4. **Supabase local CLI in CI** — integration test job shared by both workflows
5. **Dependabot config** — `.github/dependabot.yml`
6. **Sentry** — install SDK in app + worker, wire sourcemap upload in deploy step
7. **`deploy.yml`** — Vercel prod deploy + Fly.io worker deploy + Sentry release
8. **Playwright** — install + three critical path suites + wire into `deploy.yml`
9. **Snyk** — add to `deploy.yml` security job
10. **Vitest coverage enforcement** — add `--coverage` thresholds to CI jobs
