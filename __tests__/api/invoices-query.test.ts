import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET } from '@/app/api/invoices/route';
import { NextRequest } from 'next/server';

function req(url: string) {
  return new NextRequest(url);
}

describe('GET /api/invoices query params', () => {
  beforeEach(() => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({
      userId: 'u1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'member',
    });
  });

  it('parses sort=overcharge_desc without throwing', async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const supabase = { from };
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const res = await GET(req(
      'http://localhost/api/invoices?status=action_needed&sort=overcharge_desc&limit=5&offset=0'
    ));
    expect(from).toHaveBeenCalled();
  });
});
