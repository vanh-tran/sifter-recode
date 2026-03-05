/**
 * GET /api/findings
 * 
 * List findings for the authenticated user's organization
 * 
 * Query parameters:
 * - severity: 'high', 'medium', 'low', 'info', 'critical'
 * - leak_type: 'leak_type'
 * - rule_id: 'rule_id'
 * - min_confidence: '0' | '0.7' | '0.9' (0 = no floor, show all)
 * - max_confidence: '0.9' (optional, exclusive upper bound for medium-confidence)
 * - limit: '25'
 * - offset: '0'
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 25;
const MAX_OFFSET = 10_000;

const SEVERITY_ALLOWLIST = ['critical', 'high', 'medium', 'low', 'info'] as const;
const MAX_FILTER_LEN = 64;
const FILTER_PATTERN = /^[a-zA-Z0-9_-]+$/;

const CACHE_HEADERS = {
    'Cache-Control': 'private, max-age=120',
    'Vary': 'Authorization',
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
    const severity = searchParams.get('severity');
    const leak_type = searchParams.get('leak_type');
    const rule_id = searchParams.get('rule_id');

    // F3: Allowlist validation for severity, leak_type, rule_id
    const isValidSeverity = !severity || severity === 'all' || SEVERITY_ALLOWLIST.includes(severity as (typeof SEVERITY_ALLOWLIST)[number]);
    if (!isValidSeverity) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 });
    }
    const isValidFilter = (s: string | null) =>
      !s || s === 'all' || (s.length <= MAX_FILTER_LEN && FILTER_PATTERN.test(s));
    if (!isValidFilter(leak_type)) {
      return NextResponse.json({ error: 'Invalid leak_type' }, { status: 400 });
    }
    if (!isValidFilter(rule_id)) {
      return NextResponse.json({ error: 'Invalid rule_id' }, { status: 400 });
    }

    // F4: Validate min_confidence to [0, 1]; 0 = no floor (show all)
    const rawMinConf = parseFloat(searchParams.get('min_confidence') ?? '');
    const min_confidence =
      Number.isFinite(rawMinConf) && rawMinConf >= 0 && rawMinConf <= 1
        ? rawMinConf
        : 0.7;

    // max_confidence: exclusive upper bound (e.g. 0.9 for "medium" = confidence < 0.9)
    const rawMaxConf = parseFloat(searchParams.get('max_confidence') ?? '');
    const max_confidence =
      Number.isFinite(rawMaxConf) && rawMaxConf >= 0 && rawMaxConf <= 1
        ? rawMaxConf
        : null;
    if (max_confidence !== null && max_confidence <= min_confidence) {
      return NextResponse.json(
        { error: 'max_confidence must be greater than min_confidence' },
        { status: 400 }
      );
    }

    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), 100);
    const rawOffset = parseInt(searchParams.get('offset') || '', 10);
    // F5: Cap offset to prevent expensive queries
    const offset = Math.min(
      Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0),
      MAX_OFFSET
    );

    // Build base query for count
    let countQuery = supabase
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId);

    if (min_confidence > 0) {
      countQuery = countQuery.gte('confidence', min_confidence);
    }
    if (max_confidence !== null) {
      countQuery = countQuery.lt('confidence', max_confidence);
    }

    if (severity && severity !== 'all') {
      countQuery = countQuery.eq('severity', severity);
    }
    if (leak_type && leak_type !== 'all') {
      countQuery = countQuery.eq('leak_type', leak_type);
    }
    if (rule_id && rule_id !== 'all') {
      countQuery = countQuery.eq('rule_id', rule_id);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Error counting findings:', countError);
      return NextResponse.json(
        { error: 'Failed to fetch findings' },
        { status: 500 }
      );
    }

    const total = totalCount ?? 0;

    // Build main query (slim select for list view)
    // F6: Omit evidence_json and reasoning from list - full content available in invoice detail
    let query = supabase
      .from('findings')
      .select(`
      id,
      invoice_id,
      leak_type,
      rule_id,
      severity,
      confidence,
      expected_amount,
      charged_amount,
      delta_amount,
      delta_percent,
      estimated_savings,
      summary,
      duplicate_invoice_id,
      proof_required,
      proof_provided,
      proof_type,
      required_proof_description,
      created_at,
      invoices!findings_invoice_id_fkey (
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

    if (min_confidence > 0) {
      query = query.gte('confidence', min_confidence);
    }
    if (max_confidence !== null) {
      query = query.lt('confidence', max_confidence);
    }

    if (severity && severity !== 'all') {
      query = query.eq('severity', severity);
    }
    if (leak_type && leak_type !== 'all') {
      query = query.eq('leak_type', leak_type);
    }
    if (rule_id && rule_id !== 'all') {
      query = query.eq('rule_id', rule_id);
    }

    const { data: findings, error } = await query;

    if (error) {
      console.error('Error fetching findings:', error);
      return NextResponse.json(
        { error: 'Failed to fetch findings' },
        { status: 500 }
      );
    }

    // Compute total_savings from estimated_savings (null-safe sum)
    const totalSavings =
      findings?.reduce(
        (sum, f) => sum + (typeof f.estimated_savings === 'number' ? f.estimated_savings : 0),
        0
      ) ?? 0;

    // Format response (evidence_json, reasoning omitted for list - see invoice detail for full)
    const formattedFindings = findings?.map((finding) => ({
      id: finding.id,
      invoice_id: finding.invoice_id,
      leak_type: finding.leak_type,
      rule_id: finding.rule_id,
      severity: finding.severity,
      confidence: finding.confidence,
      expected_amount: finding.expected_amount,
      charged_amount: finding.charged_amount,
      delta_amount: finding.delta_amount,
      delta_percent: finding.delta_percent,
      estimated_savings: finding.estimated_savings,
      summary: finding.summary,
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
        findings: formattedFindings,
        total,
        limit,
        offset,
        summary: { total_savings: totalSavings },
      },
      { headers: CACHE_HEADERS }
    );

  } catch (error) {
    console.error('Error in GET /api/findings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}