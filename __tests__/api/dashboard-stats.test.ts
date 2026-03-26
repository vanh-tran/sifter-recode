import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET } from '@/app/api/dashboard/stats/route';
import { NextRequest } from 'next/server';

describe('GET /api/dashboard/stats', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/dashboard/stats'));
    expect(res.status).toBe(401);
  });
});
