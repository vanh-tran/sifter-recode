import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { NextResponse } from 'next/server';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET() {
  const supabase = await createClient();
  const authContext = await getAuthOrgContext(supabase);
  if (!authContext) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { orgId, role } = authContext;
  const denied = requirePermission(role, 'invoices:read');
  if (denied) return denied;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const statusCount = async (status: string) => {
    const { count, error } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('ui_status', status);
    if (error) throw error;
    return count ?? 0;
  };

  const [action_needed, reviewing, cleared] = await Promise.all([
    statusCount('action_needed'),
    statusCount('reviewing'),
    statusCount('cleared'),
  ]);

  const { data: inv30, error: invErr } = await supabase
    .from('invoices')
    .select('overcharge_amount')
    .eq('org_id', orgId)
    .gte('created_at', sinceIso);

  if (invErr) {
    console.error(invErr);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const overcharges_found_30d = (inv30 ?? []).reduce(
    (s, r) => s + Number(r.overcharge_amount ?? 0),
    0
  );

  const { data: recRows, error: recErr } = await supabase
    .from('disputes')
    .select('recovered_amount, updated_at, resolved_at')
    .eq('org_id', orgId)
    .not('recovered_amount', 'is', null);

  if (recErr) {
    console.error(recErr);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const recovered_30d = (recRows ?? [])
    .filter((r) => {
      const t = r.resolved_at ?? r.updated_at;
      return t && new Date(t) >= new Date(sinceIso);
    })
    .reduce((s, r) => s + Number(r.recovered_amount ?? 0), 0);

  return NextResponse.json(
    { action_needed, reviewing, cleared, overcharges_found_30d, recovered_30d },
    { headers: NO_CACHE }
  );
}
