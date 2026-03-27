import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/auth-context', () => ({
  getAuthOrgContext: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { NextRequest } from 'next/server';

describe('GET /api/team', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/team');
    const { GET } = await import('@/app/api/team/route');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/team', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/team', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', role: 'member' }),
    });
    const { POST } = await import('@/app/api/team/route');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
