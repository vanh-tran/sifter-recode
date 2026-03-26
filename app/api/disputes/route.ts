import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { NextRequest, NextResponse } from 'next/server';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const authContext = await getAuthOrgContext(supabase);
  if (!authContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { orgId, role } = authContext;
  const denied = requirePermission(role, 'disputes:create');
  if (denied) return denied;

  const scope = request.nextUrl.searchParams.get('scope') ?? 'active';

  let query = supabase
    .from('disputes')
    .select(`
      id,
      status,
      total_disputed_amount,
      disputed_finding_ids,
      updated_at,
      invoice_id,
      invoices (
        invoice_number,
        carriers ( name_normalized )
      )
    `)
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });

  if (scope === 'active') {
    query = query.in('status', ['draft', 'reviewing', 'sent', 'carrier_replied']);
  } else if (scope === 'resolved') {
    query = query.in('status', ['resolved', 'cleared', 'withdrawn']);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ disputes: data ?? [] }, { headers: NO_CACHE });
}
