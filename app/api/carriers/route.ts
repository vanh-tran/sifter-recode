import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: carriers, error } = await supabase
    .from('carriers')
    .select(`
      id, name_normalized, scac, billing_email, billing_email_confirmed, created_at,
      rate_sheets ( id, document_id, effective_date, uploaded_at, status,
        documents ( filename )
      )
    `)
    .eq('org_id', ctx.orgId)
    .order('name_normalized', { ascending: true });

  if (error) {
    console.error('GET /api/carriers error:', error);
    return NextResponse.json({ error: 'Failed to fetch carriers' }, { status: 500 });
  }

  // Attach invoice counts
  const carrierIds = (carriers ?? []).map((c) => c.id);
  let invoiceCounts: Record<string, number> = {};
  if (carrierIds.length > 0) {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('carrier_id')
      .eq('org_id', ctx.orgId)
      .in('carrier_id', carrierIds);
    if (invoices) {
      invoiceCounts = invoices.reduce((acc, inv) => {
        acc[inv.carrier_id] = (acc[inv.carrier_id] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }
  }

  const formatted = (carriers ?? []).map((c) => {
    const sheets = (c.rate_sheets as Array<{
      id: string; document_id: string; effective_date: string | null;
      uploaded_at: string; status: string; documents: { filename: string } | null;
    }> ?? []).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
    return {
      id: c.id,
      name: c.name_normalized,
      scac: c.scac ?? null,
      billing_email: c.billing_email ?? null,
      billing_email_confirmed: c.billing_email_confirmed,
      invoice_count: invoiceCounts[c.id] ?? 0,
      rate_sheets: sheets.map((s) => ({
        id: s.id,
        filename: (s.documents as { filename: string } | null)?.filename ?? 'rate-sheet.pdf',
        effective_date: s.effective_date,
        status: s.status === 'current' ? 'current' : 'superseded',
      })),
    };
  });

  return NextResponse.json({ carriers: formatted }, { headers: NO_CACHE });
}
