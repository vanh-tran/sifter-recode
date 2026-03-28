import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@sifter/core/queue/index', () => ({
  phase1Queue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/server/auth-context');

import { POST } from '@/app/api/documents/upload/route';

describe('POST /api/documents/upload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    const { getAuthOrgContext } = await import('@/lib/server/auth-context');
    vi.mocked(getAuthOrgContext).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/documents/upload', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
