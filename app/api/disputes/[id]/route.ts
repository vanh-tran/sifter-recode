import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { NextRequest, NextResponse } from 'next/server';

async function sumFindingAmounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  findingIds: string[]
) {
  if (findingIds.length === 0) return 0;
  const { data: rows } = await supabase
    .from('findings').select('delta_amount, amount_edited').eq('org_id', orgId).in('id', findingIds);
  return (rows ?? []).reduce((s, r) => s + Number(r.amount_edited ?? r.delta_amount ?? 0), 0);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { orgId, role } = authContext;
    const denied = requirePermission(role, 'disputes:create');
    if (denied) return denied;
    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(disputeId))
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    let body: { disputed_finding_ids?: string[] };
    try { body = (await request.json()) as { disputed_finding_ids?: string[] }; }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    if (!Array.isArray(body.disputed_finding_ids))
      return NextResponse.json({ error: 'disputed_finding_ids required' }, { status: 400 });
    const total_disputed_amount = await sumFindingAmounts(supabase, orgId, body.disputed_finding_ids);
    const { data: updated, error } = await supabase
      .from('disputes').update({ disputed_finding_ids: body.disputed_finding_ids, total_disputed_amount, updated_at: new Date().toISOString() })
      .eq('id', disputeId).eq('org_id', orgId).select().single();
    if (error || !updated) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    return NextResponse.json({ dispute: updated });
  } catch (e) { console.error(e); return NextResponse.json({ error: 'Internal server error' }, { status: 500 }); }
}
