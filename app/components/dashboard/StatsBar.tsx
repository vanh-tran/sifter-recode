'use client';

import Link from 'next/link';

export interface DashboardStats {
  action_needed: number;
  reviewing: number;
  cleared: number;
  overcharges_found_30d: number;
  recovered_30d: number;
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export default function StatsBar({ stats }: { stats: DashboardStats }) {
  const items: { label: string; value: number | string; href: string }[] = [
    { label: 'Action Needed', value: stats.action_needed, href: '/dashboard?tab=action_needed' },
    { label: 'Reviewing', value: stats.reviewing, href: '/dashboard?tab=reviewing' },
    { label: 'Cleared', value: stats.cleared, href: '/dashboard?tab=cleared' },
    {
      label: 'Overcharges Found (30d)',
      value: money(stats.overcharges_found_30d),
      href: '/invoices?status=action_needed',
    },
    {
      label: 'Recovered (30d)',
      value: money(stats.recovered_30d),
      href: '/disputes?tab=resolved',
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm transition-colors hover:bg-brand-surface-muted"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted">{item.label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-brand-primary">{item.value}</p>
        </Link>
      ))}
    </div>
  );
}
