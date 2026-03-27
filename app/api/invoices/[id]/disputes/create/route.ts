import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const invoiceId = resolvedParams.id;

    if (!isValidUuid(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    const body = await request.json();
    const { disputed_finding_ids = [] } = body;

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, carrier_id')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { data: carrier } = await supabase
      .from('carriers')
      .select('billing_email, billing_email_confirmed')
      .eq('id', invoice.carrier_id)
      .eq('org_id', orgId)
      .single();

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .insert({
        org_id: orgId,
        invoice_id: invoiceId,
        status: 'draft',
        disputed_finding_ids,
        recipient_email: carrier?.billing_email ?? null,
      })
      .select()
      .single();

    if (disputeError) {
      if (disputeError.code === '23505') {
        return NextResponse.json(
          { error: 'Dispute already exists for this invoice' },
          { status: 409 }
        );
      }
      console.error('Error creating dispute:', disputeError);
      return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
    }

    return NextResponse.json({ dispute }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/invoices/:id/disputes/create:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
