import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { assertTransition, type DisputeStatus } from '@/lib/disputes/state-machine';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { orgId, role } = authContext;
    const denied = requirePermission(role, 'disputes:create');
    if (denied) return denied;

    const resolvedParams = await params;
    const disputeId = resolvedParams.id;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('id, status, invoice_id')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    try {
      assertTransition(dispute.status as DisputeStatus, 'resolved');
    } catch {
      return NextResponse.json(
        { error: `Cannot resolve dispute in status '${dispute.status}'` },
        { status: 422 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const recoveredAmount = body.recovered_amount;

    if (recoveredAmount === undefined || recoveredAmount === null) {
      return NextResponse.json({ error: 'recovered_amount is required' }, { status: 400 });
    }

    if (typeof recoveredAmount !== 'number' || recoveredAmount < 0) {
      return NextResponse.json(
        { error: 'recovered_amount must be a non-negative number' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data: updatedDispute, error: updateError } = await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        recovered_amount: recoveredAmount,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error resolving dispute:', updateError);
      return NextResponse.json({ error: 'Failed to resolve dispute' }, { status: 500 });
    }

    await supabase
      .from('invoices')
      .update({ ui_status: 'archived', updated_at: now })
      .eq('id', dispute.invoice_id)
      .eq('org_id', orgId);

    return NextResponse.json({ dispute: updatedDispute });
  } catch (error) {
    console.error('Error in POST /api/disputes/:id/resolve:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
