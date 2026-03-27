import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .eq('read', false);

  if (error) return NextResponse.json({ error: 'Failed to mark all as read' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
