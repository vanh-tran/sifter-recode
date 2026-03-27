import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const { inviteId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'team:manage');
  if (forbidden) return forbidden;

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'inactive' })
    .eq('id', inviteId)
    .eq('org_id', ctx.orgId)
    .eq('status', 'invited');

  if (error) return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
