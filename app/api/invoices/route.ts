/**
 * GET /api/invoices
 *
 * List invoices for the authenticated user's organization.
 * Uses org_id from JWT claims (set by custom access token hook).
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 25;

// SECURITY: Do NOT cache user-specific data. Browser HTTP cache key does not
// include cookies when Vary is Authorization (Supabase uses cookies). Caching
// would leak Org A's invoices to Org B after switching accounts.
const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, must-revalidate',
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status'); // 'all', 'new', 'reviewing', 'action_needed', 'cleared', 'archived'
    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    const rawOffset = parseInt(searchParams.get('offset') || '', 10);
    const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), 100);
    const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

    // Build base query for count
    let countQuery = supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId);

    if (status && status !== 'all') {
      countQuery = countQuery.eq('ui_status', status);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting invoices:', countError);
      return NextResponse.json(
        { error: 'Failed to fetch invoices' },
        { status: 500 }
      );
    }

    const total = totalCount ?? 0;

    // Build main query (slim select for list view)
    let query = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        total_amount,
        currency,
        ui_status,
        created_at,
        carriers (
          name_normalized
        ),
        documents (
          filename
        )
      `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('ui_status', status);
    }

    const { data: invoices, error } = await query;

    if (error) {
      console.error('Error fetching invoices:', error);
      return NextResponse.json(
        { error: 'Failed to fetch invoices' },
        { status: 500 }
      );
    }

    // Get findings count for each invoice
    const invoiceIds = invoices?.map((inv) => inv.id) || [];
    let findingsCounts: Record<string, number> = {};

    if (invoiceIds.length > 0) {
      const { data: findings } = await supabase
        .from('findings')
        .select('invoice_id')
        .in('invoice_id', invoiceIds)
        .eq('org_id', orgId);

      if (findings) {
        findingsCounts = findings.reduce((acc, finding) => {
          acc[finding.invoice_id] = (acc[finding.invoice_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }
    }

    // Format response
    const formattedInvoices = invoices?.map((invoice) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      carrier_name: (invoice.carriers as { name_normalized?: string } | null)
        ?.name_normalized || 'Unknown',
      invoice_date: invoice.invoice_date,
      total_amount: invoice.total_amount,
      currency: invoice.currency,
      status: invoice.ui_status,
      findings_count: findingsCounts[invoice.id] || 0,
      filename:
        (Array.isArray(invoice.documents)
          ? (invoice.documents as { filename?: string }[])[0]?.filename
          : (invoice.documents as { filename?: string } | null)?.filename) ||
        'unknown.pdf',
      created_at: invoice.created_at,
    })) || [];

    return NextResponse.json(
      {
        invoices: formattedInvoices,
        total,
        limit,
        offset,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error in GET /api/invoices:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
