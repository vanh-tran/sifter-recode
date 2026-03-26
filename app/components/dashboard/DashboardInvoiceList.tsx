'use client';

import Link from 'next/link';
import type { Invoice } from '@/lib/api/invoices';
import { findingTypeToLabel } from '@/lib/finding-type-labels';

type Tab = 'action_needed' | 'reviewing' | 'cleared';

export default function DashboardInvoiceList({
  invoices,
  tab,
  onTagClick,
}: {
  invoices: Invoice[];
  tab: Tab;
  onTagClick: (findingType: string) => void;
}) {
  const formatCurrency = (n: number, c: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const actionLabel =
    tab === 'action_needed' ? 'Review' : tab === 'reviewing' ? 'View Dispute' : 'View';

  return (
    <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-brand-border">
          <thead className="bg-brand-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Carrier</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Invoice #</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Total</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Finding tags</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-brand-primary">Overcharge</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-brand-primary">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-primary">{inv.carrier_name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">{inv.invoice_number}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-muted">{formatDate(inv.invoice_date)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">{formatCurrency(inv.total_amount, inv.currency)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(inv.finding_tags ?? []).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onTagClick(t)}
                        className="rounded-full border border-brand-border bg-brand-background px-2 py-0.5 text-xs text-brand-primary hover:bg-brand-surface-muted"
                      >
                        {findingTypeToLabel(t)}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-pastel-rose-text">
                  {formatCurrency(inv.overcharge_amount ?? 0, inv.currency)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="btn-brand-primary inline-flex rounded-md px-3 py-1.5 text-xs font-medium"
                  >
                    {actionLabel}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
