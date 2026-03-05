/**
 * GET /api/invoices/:id/disputes
 *
 * List all dispute documents for an invoice.
 * Uses org_id from JWT claims for scoping.
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
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

    // Handle both sync and async params (Next.js 15+ compatibility)
    const resolvedParams = 'then' in params ? await params : params;
    const invoiceId = resolvedParams.id;

    if (!isValidUuid(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    // Verify invoice exists and belongs to user's org (scoped by org_id from JWT)
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Get dispute documents for this invoice
    const { data: disputeDocuments, error: disputesError } = await supabase
      .from('dispute_documents')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (disputesError) {
      console.error('Error fetching dispute documents:', disputesError);
      return NextResponse.json(
        { error: 'Failed to fetch dispute documents' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      dispute_documents: disputeDocuments || [],
    });
  } catch (error) {
    console.error('Error in GET /api/invoices/:id/disputes:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
