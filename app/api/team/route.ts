import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: members, error } = await supabase
    .from('memberships')
    .select(`
      id, role, status, created_at, invited_by,
      users ( id, email, full_name, avatar_url )
    `)
    .eq('org_id', ctx.orgId)
    .in('status', ['active', 'invited'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/team error:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }

  return NextResponse.json({ members: members ?? [] }, { headers: NO_CACHE });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = requirePermission(ctx.role, 'team:manage');
  if (forbidden) return forbidden;

  let body: { email?: string; role?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  const role = body.role;
  if (!email || !role || !['admin', 'member', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Valid email and role (admin|member|viewer) are required' }, { status: 400 });
  }

  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  const userId = existingUser?.id;
  if (!userId) {
    return NextResponse.json(
      { error: 'User not found. Invite emails are not yet supported; user must sign up first.' },
      { status: 422 }
    );
  }

  const { data: existing } = await supabase
    .from('memberships')
    .select('id, status')
    .eq('org_id', ctx.orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing && existing.status === 'active') {
    return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
  }

  const { data: membership, error: insertError } = await supabase
    .from('memberships')
    .upsert({
      org_id: ctx.orgId,
      user_id: userId,
      role,
      status: 'invited',
      invited_by: ctx.userId,
    })
    .select('id')
    .single();

  if (insertError || !membership) {
    console.error('POST /api/team insert error:', insertError);
    return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 });
  }

  return NextResponse.json({ membership_id: membership.id }, { status: 201, headers: NO_CACHE });
}
