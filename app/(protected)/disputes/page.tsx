'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import Header from '@/app/components/Header';
import { fetchDisputesList } from '@/lib/api/disputes';

type Scope = 'active' | 'resolved' | 'all';

interface DisputeRow {
  id: string;
  status: string;
  total_disputed_amount: number | null;
  disputed_finding_ids: string[];
  updated_at: string;
  invoice_id: string;
  invoices: {
    invoice_number: string | null;
    carriers: { name_normalized: string | null } | null;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  reviewing: 'Reviewing',
  sent: 'Sent',
  carrier_replied: 'Carrier Replied',
  resolved: 'Resolved',
  cleared: 'Cleared',
  withdrawn: 'Withdrawn',
};

export default function DisputesPage() {
  const [scope, setScope] = useState<Scope>('active');

  const { data, isLoading, error } = useQuery({
    queryKey: ['disputes', scope],
    queryFn: () => fetchDisputesList(scope),
  });

  const disputes: DisputeRow[] = data?.disputes ?? [];

  const formatAmount = (n: number | null) => {
    if (n == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
      <Header
        title="Disputes"
        subtitle="All disputes across invoices — sorted by last activity."
      />
      <div className="page-transition mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Scope tabs */}
        <div className="mb-6 border-b border-brand-border">
          <nav className="-mb-px flex space-x-6">
            {(['active', 'resolved', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium capitalize transition-colors ${
                  scope === s
                    ? 'border-brand-accent text-brand-accent'
                    : 'border-transparent text-brand-muted hover:border-brand-border hover:text-brand-primary'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {isLoading && (
          <div className="h-48 animate-pulse rounded-lg bg-brand-surface" />
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load disputes. Please try again.
          </div>
        )}

        {!isLoading && !error && disputes.length === 0 && (
          <div className="rounded-lg border border-brand-border bg-brand-surface p-10 text-center shadow-sm">
            <p className="text-sm text-brand-muted">No disputes found for this scope.</p>
            <Link
              href="/invoices"
              className="mt-4 inline-block text-sm font-medium text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
            >
              Go to invoices →
            </Link>
          </div>
        )}

        {!isLoading && !error && disputes.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface shadow-sm">
            <table className="min-w-full divide-y divide-brand-border text-sm">
              <thead className="bg-brand-surface-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Carrier</th>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Invoice #</th>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Disputed</th>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Last Updated</th>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {disputes.map((d) => (
                  <tr
                    key={d.id}
                    className={`hover:bg-brand-surface-muted ${
                      d.status === 'carrier_replied' ? 'border-l-4 border-amber-500' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-brand-primary">
                      {d.invoices?.carriers?.name_normalized ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-brand-primary">
                      {d.invoices?.invoice_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-brand-primary">
                        {STATUS_LABELS[d.status] ?? d.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-pastel-rose-text">
                      {formatAmount(d.total_disputed_amount)}
                    </td>
                    <td className="px-4 py-3 text-brand-muted">
                      {formatDate(d.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${d.invoice_id}`}
                        className="text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
                      >
                        View invoice →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
