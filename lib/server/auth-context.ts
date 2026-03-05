import type { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface AuthOrgContext {
  userId: string;
  orgId: string;
}

/**
 * Resolve authenticated user + org context for server routes.
 * Falls back to memberships when org_id claim is missing.
 */
export async function getAuthOrgContext(
  supabase: SupabaseServerClient
): Promise<AuthOrgContext | null> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as Record<string, unknown> | undefined;

  let userId = typeof claims?.sub === 'string' ? claims.sub : null;
  let orgId = typeof claims?.org_id === 'string' ? claims.org_id : null;

  // Some older sessions may not include org_id claim yet.
  if (!userId) {
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData.session?.user?.id ?? null;
  }

  if (!userId) {
    return null;
  }

  if (!orgId) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .in('status', ['active', 'invited'])
      .order('status', { ascending: true })
      .limit(1)
      .maybeSingle();

    orgId = typeof membership?.org_id === 'string' ? membership.org_id : null;
  }

  if (!orgId) {
    return null;
  }

  return { userId, orgId };
}
