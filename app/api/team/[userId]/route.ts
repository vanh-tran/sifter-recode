import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'team:manage');
  if (forbidden) return forbidden;

  let body: { role?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const role = body.role;
  if (!role || !['admin', 'member', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Valid role required' }, { status: 400 });
  }

  const { data: target } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot change owner role' }, { status: 422 });
  }

  const { error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId);

  if (error) return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: NO_CACHE });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'team:manage');
  if (forbidden) return forbidden;

  if (targetUserId === ctx.userId) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 422 });
  }

  const { data: target } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove owner' }, { status: 422 });
  }

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'inactive' })
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId);

  if (error) return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
