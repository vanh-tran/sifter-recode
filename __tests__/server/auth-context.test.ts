import { describe, it, expect, vi } from 'vitest';
import { getAuthOrgContext } from '@/lib/server/auth-context';

function makeSupabase({
  sub,
  orgId,
  membership,
}: {
  sub?: string;
  orgId?: string;
  membership?: { org_id: string; role: string } | null;
}) {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub, org_id: orgId } },
      }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: membership ?? null }),
    }),
  };
}

describe('getAuthOrgContext', () => {
  it('returns userId, orgId, and role from an active membership', async () => {
    const supabase = makeSupabase({
      sub: 'user-1',
      orgId: undefined,
      membership: { org_id: 'org-1', role: 'member' },
    });

    const ctx = await getAuthOrgContext(supabase as never);

    expect(ctx).toEqual({ userId: 'user-1', orgId: 'org-1', role: 'member' });
  });

  it('returns null when no active membership exists', async () => {
    const supabase = makeSupabase({
      sub: 'user-1',
      orgId: undefined,
      membership: null,
    });

    const ctx = await getAuthOrgContext(supabase as never);
    expect(ctx).toBeNull();
  });

  it('uses claims org_id and still fetches role', async () => {
    const supabase = makeSupabase({
      sub: 'user-1',
      orgId: 'org-from-claims',
      membership: { org_id: 'org-from-claims', role: 'admin' },
    });

    const ctx = await getAuthOrgContext(supabase as never);
    expect(ctx?.role).toBe('admin');
    expect(ctx?.orgId).toBe('org-from-claims');
  });
});
