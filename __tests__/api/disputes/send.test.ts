import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/disputes/[id]/send/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: vi.fn() }));
vi.mock('@/lib/email/send-dispute', () => ({ sendDisputeEmail: vi.fn() }));

const { createClient } = await import('@/lib/supabase/server') as any;
const { getAuthOrgContext } = await import('@/lib/server/auth-context') as any;
const { sendDisputeEmail } = await import('@/lib/email/send-dispute') as any;

const DISPUTE_ID = '00000000-0000-0000-0000-000000000001';

describe('POST /api/disputes/:id/send', () => {
  beforeEach(() => {
    getAuthOrgContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1', role: 'member' });
    sendDisputeEmail.mockResolvedValue({ threadId: 'thread-abc', messageId: 'msg-123' });
  });

  it('returns 422 when dispute is already resolved', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: DISPUTE_ID, status: 'resolved', draft_letter: 'letter', recipient_email: 'a@b.com' },
            error: null,
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: vi.fn().mockReturnValue({ select: mockSelect }) });

    const req = new NextRequest(`http://localhost/api/disputes/${DISPUTE_ID}/send`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { id: DISPUTE_ID } });
    expect(res.status).toBe(422);
  });

  it('returns 400 when draft_letter is empty', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: DISPUTE_ID, status: 'draft', draft_letter: '', recipient_email: 'a@b.com' },
            error: null,
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: vi.fn().mockReturnValue({ select: mockSelect }) });

    const req = new NextRequest(`http://localhost/api/disputes/${DISPUTE_ID}/send`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { id: DISPUTE_ID } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/letter/i);
  });
});
