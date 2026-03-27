import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { redirect } from 'next/navigation';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, timezone')
    .eq('id', ctx.orgId)
    .maybeSingle();

  if (!org) redirect('/dashboard');

  return (
    <SettingsClient
      orgId={ctx.orgId}
      orgName={org.name}
      orgTimezone={org.timezone ?? 'UTC'}
      currentUserId={ctx.userId}
      role={ctx.role}
    />
  );
}
