import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/disputes/[id]/resolve/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));

const { createClient } = await import('@/lib/supabase/server') as any;
const { getAuthOrgContext } = await import('@/lib/server/auth-context') as any;

const DISPUTE_ID = '00000000-0000-0000-0000-000000000001';

describe('POST /api/disputes/:id/resolve', () => {
  beforeEach(() => {
    getAuthOrgContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1', role: 'member' });
  });

  it('returns 422 when already resolved', async () => {
    const fromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: DISPUTE_ID, status: 'resolved', invoice_id: 'inv-1' },
              error: null,
            }),
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: fromMock });

    const req = new NextRequest(`http://localhost/api/disputes/${DISPUTE_ID}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ recovered_amount: 200 }),
    });
    const res = await POST(req, { params: { id: DISPUTE_ID } });
    expect(res.status).toBe(422);
  });

  it('returns 400 when recovered_amount is missing', async () => {
    const fromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: DISPUTE_ID, status: 'sent', invoice_id: 'inv-1' },
              error: null,
            }),
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: fromMock });

    const req = new NextRequest(`http://localhost/api/disputes/${DISPUTE_ID}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { id: DISPUTE_ID } });
    expect(res.status).toBe(400);
  });
});
