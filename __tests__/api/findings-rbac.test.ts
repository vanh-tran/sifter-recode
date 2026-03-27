import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/auth-context', () => ({
  getAuthOrgContext: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET } from '@/app/api/findings/route';
import { NextRequest } from 'next/server';

function makeRequest(url = 'http://localhost/api/findings') {
  return new NextRequest(url);
}

describe('GET /api/findings RBAC', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('does not return 403 for viewer (has findings:read)', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({
      userId: 'u1',
      orgId: 'o1',
      role: 'viewer',
    });

    const res = await GET(makeRequest());
    expect(res.status).not.toBe(403);
  });

  it('proceeds past RBAC when role is admin', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({
      userId: 'u1',
      orgId: 'o1',
      role: 'admin',
    });

    const res = await GET(makeRequest());
    expect(res.status).not.toBe(403);
  });
});
