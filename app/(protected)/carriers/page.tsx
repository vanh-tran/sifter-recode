import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { hasPermission } from '@/lib/server/rbac';
import { redirect } from 'next/navigation';
import CarriersClient from './CarriersClient';

export default async function CarriersPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const canManage = hasPermission(ctx.role, 'carriers:manage');

  return <CarriersClient canManage={canManage} />;
}
