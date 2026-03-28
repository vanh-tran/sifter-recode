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
