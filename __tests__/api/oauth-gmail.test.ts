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
import { validateAndConsumeSession, storeConnection } from '@/lib/server/oauth-connect';
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
