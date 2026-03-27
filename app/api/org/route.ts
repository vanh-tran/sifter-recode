import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { requirePermission } from '@/lib/server/rbac';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug, timezone, onboarding_completed')
    .eq('id', ctx.orgId)
    .maybeSingle();

  if (error || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  return NextResponse.json({ org }, { headers: NO_CACHE });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; timezone?: string; onboarding_completed?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // org:settings required for name/timezone changes
  if (body.name !== undefined || body.timezone !== undefined) {
    const forbidden = requirePermission(ctx.role, 'org:settings');
    if (forbidden) return forbidden;
    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.timezone === 'string') updates.timezone = body.timezone.trim();
  }

  // onboarding_completed can be set by any active member
  if (body.onboarding_completed === true) {
    updates.onboarding_completed = true;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', ctx.orgId)
    .select('id, name, timezone, onboarding_completed')
    .maybeSingle();

  if (error || !data) {
    console.error('PATCH /api/org error:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }

  return NextResponse.json({ org: data }, { headers: NO_CACHE });
}
