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
