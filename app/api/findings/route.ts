/**
 * GET /api/findings
 *
 * List findings for the authenticated user's organization (paginated).
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 25;

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
    const { orgId, role } = authContext;

    const denied = requirePermission(role, 'findings:read');
    if (denied) return denied;

    const searchParams = request.nextUrl.searchParams;
    const leak_type = searchParams.get('leak_type');
    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    const rawOffset = parseInt(searchParams.get('offset') || '', 10);
    const limit = Math.min(
      Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1),
      100
    );
    const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

    let countQuery = supabase
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId);

    if (leak_type && leak_type !== 'all') {
      countQuery = countQuery.eq('finding_type', leak_type);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting findings:', countError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    let query = supabase
      .from('findings')
      .select(`
      id,
      invoice_id,
      finding_type,
      rule_id,
      severity,
      confidence,
      expected_amount,
      charged_amount,
      delta_amount,
      delta_percent,
      estimated_savings,
      summary,
      description_edited,
      amount_edited,
      duplicate_invoice_id,
      proof_required,
      proof_provided,
      proof_type,
      required_proof_description,
      created_at,
      invoices!findings_invoice_fkey (
        id,
        invoice_number,
        invoice_date,
        total_amount,
        carriers (
          name_normalized
        )
      )
    `)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (leak_type && leak_type !== 'all') {
      query = query.eq('finding_type', leak_type);
    }

    const { data: findings, error } = await query;

    if (error) {
      console.error('Error fetching findings:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const formattedFindings = findings?.map((finding) => ({
      id: finding.id,
      invoice_id: finding.invoice_id,
      finding_type: finding.finding_type,
      rule_id: finding.rule_id,
      severity: finding.severity,
      confidence: finding.confidence,
      expected_amount: finding.expected_amount,
      charged_amount: finding.charged_amount,
      delta_amount: finding.delta_amount,
      delta_percent: finding.delta_percent,
      estimated_savings: finding.estimated_savings,
      summary: finding.summary,
      description_edited: finding.description_edited,
      amount_edited: finding.amount_edited,
      duplicate_invoice_id: finding.duplicate_invoice_id,
      proof_required: finding.proof_required,
      proof_provided: finding.proof_provided,
      proof_type: finding.proof_type,
      required_proof_description: finding.required_proof_description,
      created_at: finding.created_at,
      invoices: finding.invoices,
    }));

    return NextResponse.json(
      {
        findings: formattedFindings ?? [],
        total: totalCount ?? 0,
        limit,
        offset,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error in GET /api/findings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
