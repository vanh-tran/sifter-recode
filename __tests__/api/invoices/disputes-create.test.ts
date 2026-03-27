import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/server/auth-context', () => ({
  getAuthOrgContext: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { POST } from '@/app/api/invoices/[id]/disputes/create/route';
import { NextRequest } from 'next/server';

describe('POST /api/invoices/:id/disputes/create', () => {
  beforeEach(() => {
    vi.mocked(getAuthOrgContext).mockResolvedValue({ orgId: 'org-1', userId: 'user-1', role: 'admin' });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthOrgContext).mockResolvedValueOnce(null);
    vi.mocked(createClient).mockResolvedValue({} as never);
    const req = new NextRequest('http://localhost/api/invoices/uuid-1/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: [] }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'uuid-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid invoice UUID', async () => {
    vi.mocked(createClient).mockResolvedValue({} as never);
    const req = new NextRequest('http://localhost/api/invoices/not-a-uuid/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: [] }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
  });

  it('returns 409 when dispute already exists (UNIQUE violation)', async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'inv-1', carrier_id: 'carrier-1' }, error: null });
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSingle,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }),
        }),
      }),
    });

    // invoices query returns invoice, carriers query returns null carrier
    let callCount = 0;
    const mockFromImpl = vi.fn().mockImplementation((table: string) => {
      if (table === 'invoices') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'uuid-inv', carrier_id: 'c-1' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'carriers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'disputes') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'duplicate key' },
              }),
            }),
          }),
        };
      }
    });

    vi.mocked(createClient).mockResolvedValue({ from: mockFromImpl } as never);

    const req = new NextRequest('http://localhost/api/invoices/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: ['f-1'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});
