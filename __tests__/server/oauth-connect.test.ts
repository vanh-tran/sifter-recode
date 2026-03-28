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
