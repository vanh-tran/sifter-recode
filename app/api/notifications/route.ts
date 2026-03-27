import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 10 : rawLimit, 1), 50);

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, invoice_id, read, created_at')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('GET /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }

  const unread_count = (notifications ?? []).filter((n) => !n.read).length;

  return NextResponse.json(
    { notifications: notifications ?? [], unread_count },
    { headers: NO_CACHE }
  );
}
