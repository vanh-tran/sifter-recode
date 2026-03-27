import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/server/auth-context', () => ({
  getAuthOrgContext: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { GET, PATCH } from '@/app/api/carriers/[id]/route';
import { NextRequest } from 'next/server';

describe('GET /api/carriers', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/carriers');
    const { GET: listGET } = await import('@/app/api/carriers/route');
    const res = await listGET(req);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/carriers/:id', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/carriers/test-id', {
      method: 'PATCH',
      body: JSON.stringify({ billing_email: 'test@example.com' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'test-id' }) });
    expect(res.status).toBe(401);
  });
});
