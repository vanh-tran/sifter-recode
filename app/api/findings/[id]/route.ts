/**
 * GET /api/findings/[id]
 *
 * Get finding detail with related invoice and line items.
 * Scoped by org_id from JWT (SECURITY_GUIDE: prefer query filter over membership check).
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
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
    const findingId = resolvedParams.id;

    if (!isValidUuid(findingId)) {
      return NextResponse.json({ error: 'Invalid finding ID' }, { status: 400 });
    }

    // Scope by org_id in single query (no redundant membership check)
    const { data: finding, error: findingError } = await supabase
      .from('findings')
      .select(
        `
        *,
        invoices!findings_invoice_id_fkey (
          id,
          invoice_number,
          invoice_date,
          total_amount,
          currency,
          carriers (
            id,
            name_normalized,
            scac
          ),
          documents (
            id,
            filename
          )
        )
      `
      )
      .eq('id', findingId)
      .eq('org_id', orgId)
      .single();

    if (findingError || !finding) {
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
    }

    // Get related line items if evidence_json contains line item IDs
    let relatedLineItems: unknown[] = [];
    if (finding.evidence_json && typeof finding.evidence_json === 'object') {
      const evidence = finding.evidence_json as Record<string, unknown>;
      const lineItemIds: string[] = [];

      const baseItems = evidence.base_line_items as Array<{ id?: string }> | undefined;
      if (Array.isArray(baseItems)) {
        lineItemIds.push(
          ...baseItems
            .map((li) => (typeof li?.id === 'string' ? li.id : null))
            .filter((id): id is string => id !== null)
        );
      }
      const fuelItems = evidence.fuel_line_items as Array<{ id?: string }> | undefined;
      if (Array.isArray(fuelItems)) {
        lineItemIds.push(
          ...fuelItems
            .map((li) => (typeof li?.id === 'string' ? li.id : null))
            .filter((id): id is string => id !== null)
        );
      }
      const sourceId = evidence.source_line_item_id;
      if (typeof sourceId === 'string') {
        lineItemIds.push(sourceId);
      }

      if (lineItemIds.length > 0) {
        const { data: lineItems } = await supabase
          .from('invoice_line_items')
          .select('*')
          .in('id', lineItemIds)
          .eq('org_id', orgId);
        relatedLineItems = lineItems ?? [];
      }
    }

    return NextResponse.json({
      finding,
      related_line_items: relatedLineItems,
    });
  } catch (error) {
    console.error('Error fetching finding:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/findings/[id]
 *
 * Update finding data with automatic recalculation of delta_amount and delta_percent.
 */

const MAX_STRING_LEN = 10000;

export async function PATCH(
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
    const findingId = resolvedParams.id;

    if (!isValidUuid(findingId)) {
      return NextResponse.json({ error: 'Invalid finding ID' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      expected_amount,
      charged_amount,
      summary,
      reasoning,
      proof_provided,
      proof_type,
      required_proof_description,
    } = body;

    // Fetch existing finding scoped by org_id
    const { data: existingFinding, error: findingError } = await supabase
      .from('findings')
      .select('*')
      .eq('id', findingId)
      .eq('org_id', orgId)
      .single();

    if (findingError || !existingFinding) {
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (expected_amount !== undefined) {
      const val =
        expected_amount === null || expected_amount === ''
          ? null
          : parseFloat(String(expected_amount));
      updateData.expected_amount =
        val === null || Number.isFinite(val) ? val : existingFinding.expected_amount;
    }
    if (charged_amount !== undefined) {
      const val =
        charged_amount === null || charged_amount === ''
          ? null
          : parseFloat(String(charged_amount));
      updateData.charged_amount =
        val === null || Number.isFinite(val) ? val : existingFinding.charged_amount;
    }
    if (summary !== undefined) {
      const s = typeof summary === 'string' ? summary : String(summary);
      updateData.summary = s.length <= MAX_STRING_LEN ? s : existingFinding.summary;
    }
    if (reasoning !== undefined) {
      const r = typeof reasoning === 'string' ? reasoning : String(reasoning);
      updateData.reasoning = r.length <= MAX_STRING_LEN ? r : existingFinding.reasoning;
    }
    if (proof_provided !== undefined) {
      updateData.proof_provided = Boolean(proof_provided);
    }
    if (proof_type !== undefined) {
      const pt =
        proof_type === null || proof_type === ''
          ? null
          : String(proof_type).slice(0, 256);
      updateData.proof_type = pt;
    }
    if (required_proof_description !== undefined) {
      const rpd =
        required_proof_description === null || required_proof_description === ''
          ? null
          : String(required_proof_description).slice(0, MAX_STRING_LEN);
      updateData.required_proof_description = rpd;
    }

    const finalExpected =
      'expected_amount' in updateData
        ? (updateData.expected_amount as number | null)
        : existingFinding.expected_amount;
    const finalCharged =
      'charged_amount' in updateData
        ? (updateData.charged_amount as number | null)
        : existingFinding.charged_amount;

    if (finalExpected !== null && finalCharged !== null) {
      updateData.delta_amount = finalCharged - finalExpected;
      updateData.delta_percent =
        finalExpected !== 0
          ? ((updateData.delta_amount as number) / finalExpected) * 100
          : null;
    } else if (finalExpected !== null || finalCharged !== null) {
      updateData.delta_amount = 0;
      updateData.delta_percent = null;
    }

    const { data: updatedFinding, error: updateError } = await supabase
      .from('findings')
      .update(updateData)
      .eq('id', findingId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating finding:', updateError);
      return NextResponse.json(
        { error: 'Failed to update finding' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      finding: updatedFinding,
      success: true,
    });
  } catch (error) {
    console.error('Error in PATCH /api/findings/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
