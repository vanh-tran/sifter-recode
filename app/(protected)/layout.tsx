import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { OrgProvider } from '@/app/components/OrgProvider';
import Navbar from '@/app/components/Navbar';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;

  if (!claims?.sub) {
    redirect('/login');
  }

  let orgId = (claims.org_id as string) ?? null;

  if (!orgId) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', claims.sub as string)
      .in('status', ['active', 'invited'])
      .order('status', { ascending: true })
      .limit(1)
      .maybeSingle();

    orgId = membership?.org_id ?? null;
  }

  if (!orgId) {
    const user = (await supabase.auth.getSession()).data.session?.user;
    const userEmail = user?.email;
    const userName =
      user?.user_metadata?.full_name ||
      userEmail?.split('@')[0] ||
      'User';

    const orgName = `${userName}'s Organization`;
    const orgSlug =
      userEmail?.split('@')[0]?.toLowerCase() ||
      `org-${(claims.sub as string).substring(0, 8)}`;

    const { data: newOrgId } = await supabase.rpc(
      'create_org_with_owner_membership',
      { p_org_name: orgName, p_org_slug: orgSlug }
    );

    orgId = newOrgId ?? null;
  }

  if (orgId) {
    const pathname = (await headers()).get('x-pathname') ?? '';
    if (!pathname.startsWith('/onboarding')) {
      const { data: org } = await supabase
        .from('organizations')
        .select('onboarding_completed')
        .eq('id', orgId)
        .maybeSingle();

      if (org && !org.onboarding_completed) {
        redirect('/onboarding');
      }
    }
  }

  return (
    <OrgProvider orgId={orgId}>
      <div className="min-h-screen bg-brand-background">
        <Navbar />
        {children}
      </div>
    </OrgProvider>
  );
}
