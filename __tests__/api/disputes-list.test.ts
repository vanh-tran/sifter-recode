import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET } from '@/app/api/disputes/route';
import { NextRequest } from 'next/server';

describe('GET /api/disputes', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await GET(new NextRequest('http://localhost/api/disputes'));
    expect(res.status).toBe(401);
  });
});
