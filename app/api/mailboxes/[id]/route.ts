import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'mailboxes:manage');
  if (forbidden) return forbidden;

  const admin = createServiceRoleClient();

  // Verify the connection belongs to this org before touching it
  const { data: conn } = await admin
    .from('email_connections')
    .select('id')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  if (!conn) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });

  // Delete tokens first (no org_id column — requires service role to bypass RLS)
  const { error: tokenError } = await admin
    .from('oauth_tokens')
    .delete()
    .eq('connection_id', id);

  if (tokenError) {
    console.error('DELETE /api/mailboxes token delete error:', tokenError);
    return NextResponse.json({ error: 'Failed to revoke tokens' }, { status: 500 });
  }

  const { error } = await admin
    .from('email_connections')
    .update({ status: 'disconnected' })
    .eq('id', id);

  if (error) {
    console.error('DELETE /api/mailboxes status update error:', error);
    return NextResponse.json({ error: 'Failed to disconnect mailbox' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
