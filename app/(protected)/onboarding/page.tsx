import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { redirect } from 'next/navigation';
import OnboardingWizard from './OnboardingWizard';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const { data: org } = await supabase
    .from('organizations')
    .select('name, onboarding_completed')
    .eq('id', ctx.orgId)
    .maybeSingle();

  if (!org) redirect('/dashboard');
  if (org.onboarding_completed) redirect('/dashboard');

  return <OnboardingWizard orgName={org.name} />;
}
