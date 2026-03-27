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

describe('PATCH /api/org', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/org', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    });
    const { PATCH } = await import('@/app/api/org/route');
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});
