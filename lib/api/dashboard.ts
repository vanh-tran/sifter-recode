import type { DashboardStats } from '@/app/components/dashboard/StatsBar';

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await fetch('/api/dashboard/stats', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to load dashboard stats');
  }
  return res.json();
}
