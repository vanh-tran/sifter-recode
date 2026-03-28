# Gmail + Outlook OAuth Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Gmail and Outlook OAuth connect + callback routes so users can connect mailboxes from Settings or Onboarding.

**Architecture:** 4 route files (connect + callback × 2 providers) backed by a shared utility (`lib/server/oauth-connect.ts`) for PKCE, session management, and DB writes. `oauth_return_to` cookie carries the user's origin (settings vs onboarding) across the redirect. Frontend reads `?error=` on return and shows an inline dismissible banner.

**Tech Stack:** Next.js App Router route handlers, Supabase (service role), Google KMS (`oauth-token-crypto.ts`), Google OAuth 2.0, Microsoft OAuth 2.0 (MSAL endpoint), Vitest

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260328000001_oauth_unique_constraints.sql` | Unique constraints needed for upsert |
| Modify | `lib/server/oauth-token-crypto.ts` | Add `encryptOAuthSecret` |
| Create | `lib/server/oauth-connect.ts` | PKCE, session create/validate, `storeConnection` |
| Create | `app/api/oauth/gmail/connect/route.ts` | Initiate Gmail OAuth |
| Create | `app/api/gmail/connect/callback/route.ts` | Gmail callback handler |
| Create | `app/api/oauth/outlook/connect/route.ts` | Initiate Outlook OAuth |
| Create | `app/api/outlook/connect/callback/route.ts` | Outlook callback handler |
| Modify | `app/components/settings/MailboxesTab.tsx` | Add `?return_to=settings` + error banner |
| Modify | `app/(protected)/onboarding/OnboardingWizard.tsx` | Add `?return_to=onboarding` + error banner |
| Create | `__tests__/server/oauth-connect.test.ts` | Unit tests for shared utility |
| Create | `__tests__/api/oauth-gmail.test.ts` | Route tests: Gmail connect + callback |
| Create | `__tests__/api/oauth-outlook.test.ts` | Route tests: Outlook connect + callback |

---

## Task 1: DB Migration — unique constraints

The `storeConnection` utility upserts on `(org_id, provider, email)` for `email_connections` and on `connection_id` for `oauth_tokens`. Without unique constraints these upserts will insert duplicates.

**Files:**
- Create: `supabase/migrations/20260328000001_oauth_unique_constraints.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260328000001_oauth_unique_constraints.sql
-- Required by the OAuth callback's storeConnection upserts.

ALTER TABLE public.email_connections
  ADD CONSTRAINT email_connections_org_provider_email_key
    UNIQUE (org_id, provider, email);

ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_connection_id_key
    UNIQUE (connection_id);
```

- [ ] **Step 2: Apply to local Supabase (if running)**

```bash
supabase db push
# or if using migrations directly:
# supabase migration up
```

If not running Supabase locally, skip — the migration runs on deploy.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260328000001_oauth_unique_constraints.sql
git commit -m "feat: add unique constraints for OAuth upserts"
```

---

## Task 2: Add `encryptOAuthSecret` to oauth-token-crypto.ts

`decryptOAuthSecret` already exists. We need the matching encrypt function. Uses KMS in production, base64 in development (same pattern as decrypt).

**Files:**
- Modify: `lib/server/oauth-token-crypto.ts`
- Create: `__tests__/server/oauth-token-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/server/oauth-token-crypto.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: vi.fn().mockImplementation(() => ({})),
}));

describe('encryptOAuthSecret (dev mode)', () => {
  beforeEach(() => {
    delete process.env.OAUTH_KMS_KEY_NAME;
    process.env.NODE_ENV = 'development';
  });

  it('base64-encodes plaintext in development', async () => {
    const { encryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    const result = await encryptOAuthSecret('my-secret');
    expect(result).toBe(Buffer.from('my-secret').toString('base64'));
  });

  it('round-trips with decryptOAuthSecret', async () => {
    const { encryptOAuthSecret, decryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    const encrypted = await encryptOAuthSecret('round-trip-secret');
    const decrypted = await decryptOAuthSecret(encrypted);
    expect(decrypted).toBe('round-trip-secret');
  });

  it('throws in production when OAUTH_KMS_KEY_NAME is missing', async () => {
    process.env.NODE_ENV = 'production';
    const { encryptOAuthSecret } = await import('@/lib/server/oauth-token-crypto');
    await expect(encryptOAuthSecret('x')).rejects.toThrow('OAUTH_KMS_KEY_NAME is not configured');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test __tests__/server/oauth-token-crypto.test.ts
```

Expected: FAIL — `encryptOAuthSecret is not a function`

- [ ] **Step 3: Add `encryptOAuthSecret` to the file**

The full updated file:

```typescript
// lib/server/oauth-token-crypto.ts
import { KeyManagementServiceClient } from '@google-cloud/kms';

const kms = new KeyManagementServiceClient();

export async function encryptOAuthSecret(plaintext: string): Promise<string> {
  const keyName = process.env.OAUTH_KMS_KEY_NAME;
  if (!keyName) {
    if (process.env.NODE_ENV === 'development') {
      return Buffer.from(plaintext).toString('base64');
    }
    throw new Error('OAUTH_KMS_KEY_NAME is not configured');
  }
  const [result] = await kms.encrypt({
    name: keyName,
    plaintext: Buffer.from(plaintext),
  });
  return Buffer.from(result.ciphertext!).toString('base64');
}

export async function decryptOAuthSecret(ciphertext: string): Promise<string> {
  const keyName = process.env.OAUTH_KMS_KEY_NAME;
  if (!keyName) {
    if (process.env.NODE_ENV === 'development') {
      return Buffer.from(ciphertext, 'base64').toString('utf-8');
    }
    throw new Error('OAUTH_KMS_KEY_NAME is not configured');
  }
  const [result] = await kms.decrypt({
    name: keyName,
    ciphertext: Buffer.from(ciphertext, 'base64'),
  });
  return Buffer.from(result.plaintext!).toString('utf-8');
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test __tests__/server/oauth-token-crypto.test.ts
```

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add lib/server/oauth-token-crypto.ts __tests__/server/oauth-token-crypto.test.ts
git commit -m "feat: add encryptOAuthSecret to oauth-token-crypto"
```

---

## Task 3: Shared OAuth utility (`lib/server/oauth-connect.ts`)

Three exported functions:
- `generatePkce()` — pure, generates PKCE pair
- `createOAuthSession(...)` — inserts `oauth_sessions` row
- `validateAndConsumeSession(state)` — looks up session, validates, marks used
- `storeConnection(...)` — encrypts tokens, upserts `email_connections` + `oauth_tokens`

**Files:**
- Create: `lib/server/oauth-connect.ts`
- Create: `__tests__/server/oauth-connect.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/server/oauth-connect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/server/oauth-token-crypto', () => ({
  encryptOAuthSecret: vi.fn(async (s: string) => `enc:${s}`),
}));

import { createServiceRoleClient } from '@/lib/supabase/service-role';

describe('generatePkce', () => {
  it('returns a base64url code_verifier and code_challenge', async () => {
    const { generatePkce } = await import('@/lib/server/oauth-connect');
    const { codeVerifier, codeChallenge } = generatePkce();
    expect(typeof codeVerifier).toBe('string');
    expect(codeVerifier.length).toBeGreaterThan(20);
    expect(typeof codeChallenge).toBe('string');
  });

  it('generates unique verifiers on each call', async () => {
    const { generatePkce } = await import('@/lib/server/oauth-connect');
    expect(generatePkce().codeVerifier).not.toBe(generatePkce().codeVerifier);
  });

  it('challenge is SHA-256 base64url of verifier', async () => {
    const { createHash } = await import('crypto');
    const { generatePkce } = await import('@/lib/server/oauth-connect');
    const { codeVerifier, codeChallenge } = generatePkce();
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });
});

describe('validateAndConsumeSession', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when state not found', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
    };
    vi.mocked(createServiceRoleClient).mockReturnValue(mockAdmin as never);
    const { validateAndConsumeSession } = await import('@/lib/server/oauth-connect');
    const result = await validateAndConsumeSession('nonexistent-state');
    expect(result).toBeNull();
  });

  it('returns null when session status is used', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'sid',
            org_id: 'o1',
            user_id: 'u1',
            code_verifier: 'v',
            status: 'used',
            expires_at: new Date(Date.now() + 60000).toISOString(),
          },
        }),
      }),
    };
    vi.mocked(createServiceRoleClient).mockReturnValue(mockAdmin as never);
    const { validateAndConsumeSession } = await import('@/lib/server/oauth-connect');
    const result = await validateAndConsumeSession('some-state');
    expect(result).toBeNull();
  });

  it('returns null when session is expired', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'sid',
            org_id: 'o1',
            user_id: 'u1',
            code_verifier: 'v',
            status: 'pending',
            expires_at: new Date(Date.now() - 1000).toISOString(),
          },
        }),
      }),
    };
    vi.mocked(createServiceRoleClient).mockReturnValue(mockAdmin as never);
    const { validateAndConsumeSession } = await import('@/lib/server/oauth-connect');
    const result = await validateAndConsumeSession('some-state');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test __tests__/server/oauth-connect.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `lib/server/oauth-connect.ts`**

```typescript
// lib/server/oauth-connect.ts
import { randomBytes, createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { encryptOAuthSecret } from '@/lib/server/oauth-token-crypto';

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export async function createOAuthSession({
  orgId,
  userId,
  state,
  codeVerifier,
  codeChallenge,
}: {
  orgId: string;
  userId: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin.from('oauth_sessions').insert({
    org_id: orgId,
    user_id: userId,
    state,
    code_verifier: codeVerifier,
    code_challenge: codeChallenge,
    status: 'pending',
  });
  if (error) throw new Error(`Failed to create OAuth session: ${error.message}`);
}

export async function validateAndConsumeSession(state: string): Promise<{
  orgId: string;
  userId: string;
  codeVerifier: string;
} | null> {
  const admin = createServiceRoleClient();
  const { data: session } = await admin
    .from('oauth_sessions')
    .select('id, org_id, user_id, code_verifier, status, expires_at')
    .eq('state', state)
    .maybeSingle();

  if (!session) return null;
  if (session.status !== 'pending') return null;
  if (new Date(session.expires_at) < new Date()) return null;

  await admin.from('oauth_sessions').update({ status: 'used' }).eq('id', session.id);

  return {
    orgId: session.org_id as string,
    userId: session.user_id as string,
    codeVerifier: session.code_verifier as string,
  };
}

export async function storeConnection({
  orgId,
  userId,
  provider,
  email,
  refreshToken,
  accessToken,
  tokenExpiry,
}: {
  orgId: string;
  userId: string;
  provider: 'gmail' | 'outlook';
  email: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry: Date | null;
}): Promise<void> {
  const admin = createServiceRoleClient();

  const [encryptedRefresh, encryptedAccess] = await Promise.all([
    encryptOAuthSecret(refreshToken),
    encryptOAuthSecret(accessToken),
  ]);

  const { data: conn, error: connError } = await admin
    .from('email_connections')
    .upsert(
      { org_id: orgId, user_id: userId, provider, email, status: 'active' },
      { onConflict: 'org_id,provider,email' }
    )
    .select('id')
    .single();

  if (connError || !conn) {
    throw new Error(`Failed to upsert email_connections: ${connError?.message}`);
  }

  const { error: tokenError } = await admin
    .from('oauth_tokens')
    .upsert(
      {
        connection_id: conn.id,
        refresh_token_encrypted: encryptedRefresh,
        access_token_encrypted: encryptedAccess,
        expires_at: tokenExpiry?.toISOString() ?? null,
      },
      { onConflict: 'connection_id' }
    );

  if (tokenError) throw new Error(`Failed to upsert oauth_tokens: ${tokenError.message}`);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test __tests__/server/oauth-connect.test.ts
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add lib/server/oauth-connect.ts __tests__/server/oauth-connect.test.ts
git commit -m "feat: add shared OAuth connect utility (PKCE, session, storeConnection)"
```

---

## Task 4: Gmail connect route

**Files:**
- Create: `app/api/oauth/gmail/connect/route.ts`
- Create: `__tests__/api/oauth-gmail.test.ts` (connect tests only — callback added in Task 5)

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/oauth-gmail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));
vi.mock('@/lib/server/oauth-connect', () => ({
  generatePkce: vi.fn(() => ({ codeVerifier: 'test-verifier', codeChallenge: 'test-challenge' })),
  createOAuthSession: vi.fn().mockResolvedValue(undefined),
  validateAndConsumeSession: vi.fn(),
  storeConnection: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      set: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      delete: vi.fn(),
    })
  ),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { NextRequest } from 'next/server';

describe('GET /api/oauth/gmail/connect', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
    process.env.GOOGLE_GMAIL_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_GMAIL_REDIRECT_URI = 'http://localhost:3000/api/gmail/connect/callback';
  });

  it('redirects to /login when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const { GET } = await import('@/app/api/oauth/gmail/connect/route');
    const req = new NextRequest('http://localhost/api/oauth/gmail/connect');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to Google OAuth URL when authenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({ userId: 'u1', orgId: 'o1', role: 'admin' });
    const { GET } = await import('@/app/api/oauth/gmail/connect/route');
    const req = new NextRequest('http://localhost/api/oauth/gmail/connect?return_to=settings');
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('access_type=offline');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test __tests__/api/oauth-gmail.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route**

```typescript
// app/api/oauth/gmail/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { generatePkce, createOAuthSession } from '@/lib/server/oauth-connect';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url));

  const returnTo = request.nextUrl.searchParams.get('return_to') ?? 'settings';
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomUUID();

  await createOAuthSession({
    orgId: ctx.orgId,
    userId: ctx.userId,
    state,
    codeVerifier,
    codeChallenge,
  });

  const cookieStore = await cookies();
  cookieStore.set('oauth_return_to', returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 300,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_GMAIL_REDIRECT_URI!,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ].join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test __tests__/api/oauth-gmail.test.ts
```

Expected: 2 passed (connect tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/gmail/connect/route.ts __tests__/api/oauth-gmail.test.ts
git commit -m "feat: add Gmail OAuth connect route"
```

---

## Task 5: Gmail callback route

**Files:**
- Create: `app/api/gmail/connect/callback/route.ts`
- Modify: `__tests__/api/oauth-gmail.test.ts` (add callback tests)

- [ ] **Step 1: Add callback tests to `__tests__/api/oauth-gmail.test.ts`**

Append to the existing file:

```typescript
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';

describe('GET /api/gmail/connect/callback', () => {
  beforeEach(() => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_GMAIL_REDIRECT_URI = 'http://localhost:3000/api/gmail/connect/callback';
  });

  it('redirects with access_denied when provider returns error=access_denied', async () => {
    const { GET } = await import('@/app/api/gmail/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/gmail/connect/callback?error=access_denied&state=s'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=access_denied');
  });

  it('redirects with oauth_error when provider returns other error', async () => {
    const { GET } = await import('@/app/api/gmail/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/gmail/connect/callback?error=server_error&state=s'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=oauth_error');
  });

  it('redirects to /settings?error=invalid_session when state not found', async () => {
    vi.mocked(validateAndConsumeSession).mockResolvedValue(null);
    const { GET } = await import('@/app/api/gmail/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/gmail/connect/callback?code=abc&state=bad-state'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/settings?error=invalid_session');
  });

  it('redirects with token_exchange_failed when token fetch fails', async () => {
    vi.mocked(validateAndConsumeSession).mockResolvedValue({
      orgId: 'o1',
      userId: 'u1',
      codeVerifier: 'v',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400 })
    );
    const { GET } = await import('@/app/api/gmail/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/gmail/connect/callback?code=abc&state=good-state'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=token_exchange_failed');
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
pnpm test __tests__/api/oauth-gmail.test.ts
```

Expected: 2 pass (connect), 4 fail (callback — route not found)

- [ ] **Step 3: Create the callback route**

```typescript
// app/api/gmail/connect/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';

function getReturnUrl(returnTo: string | undefined): string {
  if (returnTo === 'onboarding') return '/onboarding';
  return '/settings';
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cookieStore = await cookies();
  const returnTo = cookieStore.get('oauth_return_to')?.value;
  const origin = getReturnUrl(returnTo);

  const providerError = searchParams.get('error');
  if (providerError) {
    const errorKey = providerError === 'access_denied' ? 'access_denied' : 'oauth_error';
    return NextResponse.redirect(new URL(`${origin}?error=${errorKey}`, request.url));
  }

  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code) {
    return NextResponse.redirect(new URL(`${origin}?error=oauth_error`, request.url));
  }

  const session = await validateAndConsumeSession(state);
  if (!session) {
    return NextResponse.redirect(new URL('/settings?error=invalid_session', request.url));
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_GMAIL_REDIRECT_URI!,
      grant_type: 'authorization_code',
      code_verifier: session.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=token_exchange_failed`, request.url));
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userinfoRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=userinfo_failed`, request.url));
  }

  const { email } = await userinfoRes.json();

  try {
    await storeConnection({
      orgId: session.orgId,
      userId: session.userId,
      provider: 'gmail',
      email,
      refreshToken: refresh_token,
      accessToken: access_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    });
  } catch {
    return NextResponse.redirect(new URL(`${origin}?error=connection_failed`, request.url));
  }

  cookieStore.delete('oauth_return_to');
  return NextResponse.redirect(new URL(origin, request.url));
}
```

- [ ] **Step 4: Run all Gmail tests — expect pass**

```bash
pnpm test __tests__/api/oauth-gmail.test.ts
```

Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/gmail/connect/callback/route.ts __tests__/api/oauth-gmail.test.ts
git commit -m "feat: add Gmail OAuth callback route"
```

---

## Task 6: Outlook connect route

**Files:**
- Create: `app/api/oauth/outlook/connect/route.ts`
- Create: `__tests__/api/oauth-outlook.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/oauth-outlook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));
vi.mock('@/lib/server/oauth-connect', () => ({
  generatePkce: vi.fn(() => ({ codeVerifier: 'test-verifier', codeChallenge: 'test-challenge' })),
  createOAuthSession: vi.fn().mockResolvedValue(undefined),
  validateAndConsumeSession: vi.fn(),
  storeConnection: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      set: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      delete: vi.fn(),
    })
  ),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { NextRequest } from 'next/server';

describe('GET /api/oauth/outlook/connect', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
    process.env.MICROSOFT_OUTLOOK_CLIENT_ID = 'ms-client-id';
    process.env.MICROSOFT_OUTLOOK_REDIRECT_URI =
      'http://localhost:3000/api/outlook/connect/callback';
  });

  it('redirects to /login when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const { GET } = await import('@/app/api/oauth/outlook/connect/route');
    const req = new NextRequest('http://localhost/api/oauth/outlook/connect');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to Microsoft OAuth URL when authenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({ userId: 'u1', orgId: 'o1', role: 'admin' });
    const { GET } = await import('@/app/api/oauth/outlook/connect/route');
    const req = new NextRequest(
      'http://localhost/api/oauth/outlook/connect?return_to=onboarding'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(location).toContain('code_challenge_method=S256');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm test __tests__/api/oauth-outlook.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create the route**

```typescript
// app/api/oauth/outlook/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { generatePkce, createOAuthSession } from '@/lib/server/oauth-connect';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url));

  const returnTo = request.nextUrl.searchParams.get('return_to') ?? 'settings';
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomUUID();

  await createOAuthSession({
    orgId: ctx.orgId,
    userId: ctx.userId,
    state,
    codeVerifier,
    codeChallenge,
  });

  const cookieStore = await cookies();
  cookieStore.set('oauth_return_to', returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 300,
  });

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_OUTLOOK_CLIENT_ID!,
    redirect_uri: process.env.MICROSOFT_OUTLOOK_REDIRECT_URI!,
    response_type: 'code',
    scope: [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
      'openid',
    ].join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  );
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test __tests__/api/oauth-outlook.test.ts
```

Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/outlook/connect/route.ts __tests__/api/oauth-outlook.test.ts
git commit -m "feat: add Outlook OAuth connect route"
```

---

## Task 7: Outlook callback route

**Files:**
- Create: `app/api/outlook/connect/callback/route.ts`
- Modify: `__tests__/api/oauth-outlook.test.ts`

- [ ] **Step 1: Add callback tests to `__tests__/api/oauth-outlook.test.ts`**

Append to the existing file:

```typescript
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';

describe('GET /api/outlook/connect/callback', () => {
  beforeEach(() => {
    process.env.MICROSOFT_OUTLOOK_CLIENT_ID = 'ms-client-id';
    process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET = 'ms-secret';
    process.env.MICROSOFT_OUTLOOK_REDIRECT_URI =
      'http://localhost:3000/api/outlook/connect/callback';
  });

  it('redirects with access_denied when provider returns error=access_denied', async () => {
    const { GET } = await import('@/app/api/outlook/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/outlook/connect/callback?error=access_denied&state=s'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=access_denied');
  });

  it('redirects to /settings?error=invalid_session when state not found', async () => {
    vi.mocked(validateAndConsumeSession).mockResolvedValue(null);
    const { GET } = await import('@/app/api/outlook/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/outlook/connect/callback?code=abc&state=bad-state'
    );
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/settings?error=invalid_session');
  });

  it('uses email from mail field in Microsoft /me response', async () => {
    vi.mocked(validateAndConsumeSession).mockResolvedValue({
      orgId: 'o1',
      userId: 'u1',
      codeVerifier: 'v',
    });
    vi.mocked(storeConnection).mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ mail: 'user@outlook.com', userPrincipalName: 'fallback@outlook.com' }),
        })
    );
    const { GET } = await import('@/app/api/outlook/connect/callback/route');
    const req = new NextRequest(
      'http://localhost/api/outlook/connect/callback?code=abc&state=good-state'
    );
    await GET(req);
    expect(vi.mocked(storeConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@outlook.com', provider: 'outlook' })
    );
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
pnpm test __tests__/api/oauth-outlook.test.ts
```

Expected: 2 pass (connect), 3 fail (callback — route not found)

- [ ] **Step 3: Create the callback route**

```typescript
// app/api/outlook/connect/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';

function getReturnUrl(returnTo: string | undefined): string {
  if (returnTo === 'onboarding') return '/onboarding';
  return '/settings';
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cookieStore = await cookies();
  const returnTo = cookieStore.get('oauth_return_to')?.value;
  const origin = getReturnUrl(returnTo);

  const providerError = searchParams.get('error');
  if (providerError) {
    const errorKey = providerError === 'access_denied' ? 'access_denied' : 'oauth_error';
    return NextResponse.redirect(new URL(`${origin}?error=${errorKey}`, request.url));
  }

  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code) {
    return NextResponse.redirect(new URL(`${origin}?error=oauth_error`, request.url));
  }

  const session = await validateAndConsumeSession(state);
  if (!session) {
    return NextResponse.redirect(new URL('/settings?error=invalid_session', request.url));
  }

  const tokenRes = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_OUTLOOK_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET!,
        redirect_uri: process.env.MICROSOFT_OUTLOOK_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code_verifier: session.codeVerifier,
      }),
    }
  );

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=token_exchange_failed`, request.url));
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!meRes.ok) {
    return NextResponse.redirect(new URL(`${origin}?error=userinfo_failed`, request.url));
  }

  const meData = await meRes.json();
  const email: string = meData.mail ?? meData.userPrincipalName;

  try {
    await storeConnection({
      orgId: session.orgId,
      userId: session.userId,
      provider: 'outlook',
      email,
      refreshToken: refresh_token,
      accessToken: access_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    });
  } catch {
    return NextResponse.redirect(new URL(`${origin}?error=connection_failed`, request.url));
  }

  cookieStore.delete('oauth_return_to');
  return NextResponse.redirect(new URL(origin, request.url));
}
```

- [ ] **Step 4: Run all Outlook tests — expect pass**

```bash
pnpm test __tests__/api/oauth-outlook.test.ts
```

Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add app/api/outlook/connect/callback/route.ts __tests__/api/oauth-outlook.test.ts
git commit -m "feat: add Outlook OAuth callback route"
```

---

## Task 8: MailboxesTab — `return_to` param + error banner

The connect links need `?return_to=settings`. On return, read `?error=` from URL and show a dismissible inline error banner. No toast library is installed — use an inline banner consistent with existing error patterns in this file.

**Files:**
- Modify: `app/components/settings/MailboxesTab.tsx`

- [ ] **Step 1: Update the component**

Replace the full file contents:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, AlertCircle, CheckCircle, MinusCircle, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Mailbox {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  status: 'active' | 'disconnected' | 'error';
  last_sync_at: string | null;
  last_error: string | null;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was cancelled. Please try again.',
  oauth_error: 'Something went wrong with the provider. Please try again.',
  invalid_session: 'OAuth session expired. Please try connecting again.',
  token_exchange_failed: "Couldn't complete the connection. Please try again.",
  userinfo_failed: "Couldn't fetch your email address. Please try again.",
  connection_failed: "Couldn't save the connection. Please try again.",
};

function StatusDot({ status }: { status: Mailbox['status'] }) {
  if (status === 'active') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <MinusCircle className="w-4 h-4 text-gray-400" />;
}

interface MailboxesTabProps {
  canManage: boolean;
}

export function MailboxesTab({ canManage }: MailboxesTabProps) {
  const queryClient = useQueryClient();
  const [pendingDisconnect, setPendingDisconnect] = useState<Mailbox | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setOauthError(OAUTH_ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.');
      const params = new URLSearchParams(searchParams.toString());
      params.delete('error');
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ''}`);
    }
  }, [searchParams, router, pathname]);

  const { data, isLoading } = useQuery<{ mailboxes: Mailbox[] }>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      const res = await fetch('/api/mailboxes');
      if (!res.ok) throw new Error('Failed to fetch mailboxes');
      return res.json();
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/mailboxes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
    },
    onSuccess: () => {
      setPendingDisconnect(null);
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });

  const mailboxes = data?.mailboxes ?? [];

  return (
    <div className="space-y-6">
      {oauthError && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{oauthError}</span>
          <button
            onClick={() => setOauthError(null)}
            className="shrink-0 text-red-400 hover:text-red-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
          Connected Accounts
        </h3>

        {isLoading && <p className="text-sm text-brand-muted">Loading…</p>}

        {!isLoading && mailboxes.length === 0 && (
          <p className="text-sm text-brand-muted italic">No mailboxes connected.</p>
        )}

        {mailboxes.length > 0 && (
          <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
            {mailboxes.map((mb) => (
              <li key={mb.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
                <Mail className="w-5 h-5 text-brand-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-primary truncate">{mb.email}</p>
                  <p className="text-xs text-brand-muted capitalize">
                    {mb.provider}
                    {mb.last_sync_at
                      ? ` · synced ${formatDistanceToNow(new Date(mb.last_sync_at), { addSuffix: true })}`
                      : ' · never synced'}
                  </p>
                  {mb.status === 'error' && mb.last_error && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">{mb.last_error}</p>
                  )}
                </div>
                <StatusDot status={mb.status} />
                {canManage && mb.status === 'active' && (
                  <button
                    onClick={() => setPendingDisconnect(mb)}
                    className="text-xs text-brand-muted hover:text-red-500 transition-colors ml-2"
                  >
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="flex gap-3">
          <a
            href="/api/oauth/gmail/connect?return_to=settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Gmail
          </a>
          <a
            href="/api/oauth/outlook/connect?return_to=settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Outlook
          </a>
        </div>
      )}

      {pendingDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-brand-surface border border-brand-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-brand-primary">Disconnect mailbox?</h3>
            <p className="text-sm text-brand-muted">
              <span className="font-medium text-brand-primary">{pendingDisconnect.email}</span> will
              be disconnected. Sifter will stop syncing emails from this account and all stored
              tokens will be revoked.
            </p>
            {disconnect.isError && (
              <p className="text-xs text-red-500">Something went wrong. Please try again.</p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setPendingDisconnect(null)}
                disabled={disconnect.isPending}
                className="px-3 py-1.5 text-sm text-brand-muted hover:text-brand-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => disconnect.mutate(pendingDisconnect.id)}
                disabled={disconnect.isPending}
                className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50"
              >
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
pnpm build 2>&1 | grep -E 'error|Error|MailboxesTab'
```

Expected: no errors mentioning MailboxesTab

- [ ] **Step 3: Commit**

```bash
git add app/components/settings/MailboxesTab.tsx
git commit -m "feat: add return_to param and error banner to MailboxesTab"
```

---

## Task 9: OnboardingWizard — `return_to` param + error banner

**Files:**
- Modify: `app/(protected)/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Read the current connect links in OnboardingWizard**

```bash
grep -n 'oauth\|gmail\|outlook\|connect' app/\(protected\)/onboarding/OnboardingWizard.tsx
```

Note the exact line numbers and surrounding JSX for the Gmail and Outlook connect links.

- [ ] **Step 2: Add imports at the top of `OnboardingWizard.tsx`**

Add to the existing imports (do not remove any existing ones):

```tsx
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { X } from 'lucide-react';
```

- [ ] **Step 3: Add the error map and state inside the component**

Add after the existing `useState` calls inside the component function:

```tsx
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was cancelled. Please try again.',
  oauth_error: 'Something went wrong with the provider. Please try again.',
  invalid_session: 'OAuth session expired. Please try connecting again.',
  token_exchange_failed: "Couldn't complete the connection. Please try again.",
  userinfo_failed: "Couldn't fetch your email address. Please try again.",
  connection_failed: "Couldn't save the connection. Please try again.",
};

const [oauthError, setOauthError] = useState<string | null>(null);
const searchParams = useSearchParams();
const router = useRouter();
const pathname = usePathname();

useEffect(() => {
  const error = searchParams.get('error');
  if (error) {
    setOauthError(OAUTH_ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('error');
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ''}`);
  }
}, [searchParams, router, pathname]);
```

- [ ] **Step 4: Add error banner JSX in the mailbox connect step**

In the JSX where the Gmail/Outlook connect buttons live, add the banner directly above the buttons:

```tsx
{oauthError && (
  <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
    <span>{oauthError}</span>
    <button
      onClick={() => setOauthError(null)}
      className="shrink-0 text-red-400 hover:text-red-600"
      aria-label="Dismiss"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
)}
```

- [ ] **Step 5: Update connect link hrefs to include `?return_to=onboarding`**

Change:
```tsx
href="/api/oauth/gmail/connect"
```
To:
```tsx
href="/api/oauth/gmail/connect?return_to=onboarding"
```

Change:
```tsx
href="/api/oauth/outlook/connect"
```
To:
```tsx
href="/api/oauth/outlook/connect?return_to=onboarding"
```

- [ ] **Step 6: Verify build compiles**

```bash
pnpm build 2>&1 | grep -E 'error|Error|OnboardingWizard'
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add "app/(protected)/onboarding/OnboardingWizard.tsx"
git commit -m "feat: add return_to param and error banner to OnboardingWizard"
```

---

## Task 10: Full test run + verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all existing tests pass + new tests added in Tasks 2–7

- [ ] **Step 2: Confirm no inngest references crept in**

```bash
grep -rE 'inngest|INNGEST' app lib __tests__ --include='*.ts' --include='*.tsx' || echo "CLEAN"
```

Expected: `CLEAN`

- [ ] **Step 3: Build check**

```bash
pnpm build 2>&1 | tail -10
```

Expected: exit 0

- [ ] **Step 4: Final commit if any stragglers**

```bash
git status
```

If clean, done. If not, commit remaining files with appropriate message.

---

## QA Checklist (manual, post-deploy)

- [ ] Click "Connect Gmail" from Settings → redirected to Google consent screen
- [ ] Complete Google consent → redirected back to `/settings` with mailbox listed
- [ ] Click "Connect Gmail" from Onboarding → redirected to Google consent screen
- [ ] Complete Google consent → redirected back to `/onboarding`
- [ ] Cancel Google consent → redirected back to origin with "Access was cancelled" banner
- [ ] Click "Connect Outlook" → redirected to Microsoft consent screen
- [ ] Complete Microsoft consent → redirected back to origin with mailbox listed
- [ ] Cancel Outlook consent → error banner shown
- [ ] Connect same Gmail account twice → no duplicate row in `email_connections`
- [ ] Disconnect mailbox → status set to `disconnected`, tokens deleted
