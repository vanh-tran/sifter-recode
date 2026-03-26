'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Header from '@/app/components/Header';
import StatsBar from '@/app/components/dashboard/StatsBar';
import DashboardInvoiceList from '@/app/components/dashboard/DashboardInvoiceList';
import FindingTagFilter from '@/app/components/dashboard/FindingTagFilter';
import { fetchDashboardStats } from '@/lib/api/dashboard';
import { fetchInvoices } from '@/lib/api/invoices';
import type { InvoiceFilter } from '@/lib/api/invoices';

type Tab = 'action_needed' | 'reviewing' | 'cleared';

const TABS: { id: Tab; label: string }[] = [
  { id: 'action_needed', label: 'Action Needed' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'cleared', label: 'Cleared' },
];

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get('tab') as Tab | null;
  const activeTab: Tab = rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : 'action_needed';

  const tagFilter = searchParams.get('tag') ?? undefined;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
  });

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['dashboard-invoices', activeTab, tagFilter],
    queryFn: () =>
      fetchInvoices(activeTab as InvoiceFilter, 0, 25, {
        tag: tagFilter,
        sort: 'overcharge_desc',
      }),
  });

  const handleTabChange = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    params.delete('tag');
    router.push(`/dashboard?${params.toString()}`);
  };

  const handleTagClick = (findingType: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tag', findingType);
    router.push(`/dashboard?${params.toString()}`);
  };

  return (
    <>
      <Header title="Dashboard" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {statsLoading ? (
          <div className="mb-8 h-24 animate-pulse rounded-lg bg-brand-surface" />
        ) : stats ? (
          <StatsBar stats={stats} />
        ) : null}

        {/* Tab navigation */}
        <div className="mb-6 border-b border-brand-border">
          <nav className="-mb-px flex space-x-6">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-brand-accent text-brand-accent'
                    : 'border-transparent text-brand-muted hover:border-brand-border hover:text-brand-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Active tag filter */}
        <FindingTagFilter />

        {/* Invoice list */}
        {invoicesLoading ? (
          <div className="h-48 animate-pulse rounded-lg bg-brand-surface" />
        ) : invoicesData && invoicesData.invoices.length > 0 ? (
          <DashboardInvoiceList
            invoices={invoicesData.invoices}
            tab={activeTab}
            onTagClick={handleTagClick}
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-brand-border bg-brand-surface text-brand-muted">
            No invoices in this queue
          </div>
        )}
      </main>
    </>
  );
}
