import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: connections, error } = await supabase
    .from('email_connections')
    .select('id, provider, email, status, last_sync_at, last_error, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/mailboxes error:', error);
    return NextResponse.json({ error: 'Failed to fetch mailboxes' }, { status: 500 });
  }

  return NextResponse.json({ mailboxes: connections ?? [] }, { headers: NO_CACHE });
}
