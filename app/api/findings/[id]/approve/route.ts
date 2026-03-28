/**
 * PATCH /api/findings/[id]/approve
 *
 * Approve or decline a finding for dispute document inclusion.
 * Scoped by org_id from JWT (SECURITY_GUIDE: no details in 500 responses).
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

const MAX_DISAPPROVAL_REASON_LEN = 2000;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId, orgId, role } = authContext;

    const denied = requirePermission(role, 'disputes:create');
    if (denied) return denied;

    const resolvedParams = await params;
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

    const { is_approved, disapproval_reason } = body;

    if (typeof is_approved !== 'boolean') {
      return NextResponse.json(
        { error: 'is_approved is required and must be a boolean' },
        { status: 400 }
      );
    }

    // Scope by org_id in single query (no redundant membership check)
    const { data: finding, error: findingError } = await supabase
      .from('findings')
      .select('id, org_id, invoice_id')
      .eq('id', findingId)
      .eq('org_id', orgId)
      .single();

    if (findingError || !finding) {
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 });
    }

    const updateData: {
      is_approved: boolean;
      approved_by: string;
      approved_at: string;
      disapproval_reason?: string | null;
    } = {
      is_approved,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    };

    if (!is_approved && disapproval_reason != null) {
      const reason =
        typeof disapproval_reason === 'string'
          ? disapproval_reason.slice(0, MAX_DISAPPROVAL_REASON_LEN)
          : null;
      updateData.disapproval_reason = reason;
    } else if (is_approved) {
      updateData.disapproval_reason = null;
    }

    const { data: updatedFinding, error: updateError } = await supabase
      .from('findings')
      .update(updateData)
      .eq('id', findingId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating finding approval:', updateError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (!updatedFinding) {
      console.error('Update returned no rows - RLS policy may be blocking update');
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ finding: updatedFinding });
  } catch (error) {
    console.error('Error in PATCH /api/findings/[id]/approve:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
