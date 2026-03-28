import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { canEdit, type DisputeStatus } from '@/lib/disputes/state-machine';
import { generateDisputeLetter, type FindingForLetter } from '@/lib/disputes/generate-letter';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
      .select('*, invoices(invoice_number, invoice_date, carriers(name_normalized))')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    if (!canEdit(dispute.status as DisputeStatus)) {
      return NextResponse.json(
        { error: `Cannot regenerate letter in status: ${dispute.status}` },
        { status: 422 }
      );
    }

    const findingIds: string[] = dispute.disputed_finding_ids ?? [];
    if (findingIds.length === 0) {
      return NextResponse.json(
        { error: 'No findings selected for dispute' },
        { status: 400 }
      );
    }

    const { data: findings, error: findingsError } = await supabase
      .from('findings')
      .select('id, summary, description_edited, delta_amount, amount_edited, charged_amount, expected_amount')
      .in('id', findingIds)
      .eq('org_id', orgId);

    if (findingsError || !findings) {
      return NextResponse.json({ error: 'Failed to fetch findings' }, { status: 500 });
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    const invoice = dispute.invoices as { invoice_number: string; invoice_date: string; carriers: { name_normalized: string } | null } | null;
    const carrier = invoice?.carriers;

    const totalDisputedAmount = (findings as FindingForLetter[]).reduce(
      (sum, f) => sum + (f.amount_edited ?? f.delta_amount),
      0
    );

    const letter = await generateDisputeLetter({
      invoiceNumber: invoice?.invoice_number ?? 'Unknown',
      invoiceDate: invoice?.invoice_date ?? '',
      carrierName: carrier?.name_normalized ?? 'Unknown Carrier',
      orgName: org?.name ?? 'Unknown Organization',
      findings: findings as FindingForLetter[],
      totalDisputedAmount,
    });

    const { data: updated, error: updateError } = await supabase
      .from('disputes')
      .update({
        draft_letter: letter,
        total_disputed_amount: totalDisputedAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error saving generated letter:', updateError);
      return NextResponse.json({ error: 'Failed to save letter' }, { status: 500 });
    }

    return NextResponse.json({ dispute: updated, letter });
  } catch (error) {
    console.error('Error in POST /api/disputes/:id/generate-letter:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
