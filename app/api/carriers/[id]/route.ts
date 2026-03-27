import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'carriers:manage');
  if (forbidden) return forbidden;

  let body: { billing_email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.billing_email === 'string') {
    updates.billing_email = body.billing_email.trim();
    updates.billing_email_confirmed = false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('carriers')
    .update(updates)
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .select('id, billing_email, billing_email_confirmed')
    .maybeSingle();

  if (error) {
    console.error('PATCH /api/carriers/:id error:', error);
    return NextResponse.json({ error: 'Failed to update carrier' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ carrier: data }, { headers: NO_CACHE });
}
