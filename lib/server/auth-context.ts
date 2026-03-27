import type { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export interface AuthOrgContext {
  userId: string;
  orgId: string;
  role: MemberRole;
}

/**
 * Resolve authenticated user + org context (including RBAC role) for server routes.
 * Only active memberships are considered — invited users are not yet authorised.
 */
export async function getAuthOrgContext(
  supabase: SupabaseServerClient
): Promise<AuthOrgContext | null> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as Record<string, unknown> | undefined;

  let userId = typeof claims?.sub === 'string' ? claims.sub : null;
  let orgId = typeof claims?.org_id === 'string' ? claims.org_id : null;

  if (!userId) {
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData.session?.user?.id ?? null;
  }

  if (!userId) {
    return null;
  }

  let membershipQuery = supabase
    .from('memberships')
    .select('org_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);

  if (orgId) {
    membershipQuery = membershipQuery.eq('org_id', orgId);
  }

  const { data: membership } = await membershipQuery.maybeSingle();

  if (!membership) {
    return null;
  }

  return {
    userId,
    orgId: membership.org_id as string,
    role: membership.role as MemberRole,
  };
}
