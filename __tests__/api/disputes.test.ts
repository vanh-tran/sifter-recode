import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { PATCH } from '@/app/api/disputes/[id]/route';
import { NextRequest } from 'next/server';

describe('PATCH /api/disputes/[id]', () => {
  beforeEach(() => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/disputes/abc', {
      method: 'PATCH',
      body: JSON.stringify({ disputed_finding_ids: [] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(401);
  });
});
