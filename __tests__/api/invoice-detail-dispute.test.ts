import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET } from '@/app/api/invoices/[id]/route';
import { NextRequest } from 'next/server';

describe('GET /api/invoices/[id] extended fields', () => {
  beforeEach(() => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/invoices/abc'),
      { params: Promise.resolve({ id: 'abc' }) }
    );
    expect(res.status).toBe(401);
  });
});
