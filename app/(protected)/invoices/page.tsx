'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/components/Header';
import { useAuth } from '@/app/components/AuthProvider';
import { useOrg } from '@/app/components/OrgProvider';
import { useQuery } from '@tanstack/react-query';
import { fetchInvoices, type InvoiceFilter } from '@/lib/api/invoices';

const PAGE_SIZE = 25;

function InvoicesSkeleton() {
  return (
    <div className="overflow-x-auto" role="status" aria-label="Loading invoices">
      <table className="min-w-full divide-y divide-brand-border">
        <thead className="bg-brand-surface-muted">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Invoice Number
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Carrier
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
              Findings
            </th>
          </tr>
        </thead>
        <tbody className="bg-brand-surface divide-y divide-brand-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <tr key={i} className="bg-brand-surface">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 w-24 animate-pulse rounded bg-brand-surface-muted" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 w-32 animate-pulse rounded bg-brand-surface-muted" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 w-20 animate-pulse rounded bg-brand-surface-muted" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 w-16 animate-pulse rounded bg-brand-surface-muted" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-5 w-16 animate-pulse rounded-full bg-brand-surface-muted" />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 w-8 animate-pulse rounded bg-brand-surface-muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FILTER_BUTTONS: { value: InvoiceFilter; label: string; ariaLabel: string }[] = [
  { value: 'all', label: 'All Invoices', ariaLabel: 'Show all invoices' },
  { value: 'new', label: 'New', ariaLabel: 'Show new invoices' },
  { value: 'action_needed', label: 'Action Needed', ariaLabel: 'Show invoices needing action' },
  { value: 'cleared', label: 'Cleared', ariaLabel: 'Show cleared invoices' },
];

export default function InvoicesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const orgId = useOrg();
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [page, setPage] = useState(0);

  const {
    data,
    isLoading,
    isFetching,
    error,
    isPlaceholderData,
  } = useQuery({
    queryKey: ['invoices', orgId, filter, page],
    queryFn: () => fetchInvoices(filter, page, PAGE_SIZE),
    enabled: !!user && !!orgId,
  });

  const invoices = data?.invoices ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const loading = isLoading || isFetching;

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      new: { label: 'New', className: 'bg-pastel-blue text-pastel-blue-text border border-sky-200' },
      reviewing: { label: 'Reviewing', className: 'bg-pastel-amber text-pastel-amber-text border border-amber-200' },
      action_needed: { label: 'Action Needed', className: 'bg-pastel-rose text-pastel-rose-text border border-rose-200' },
      cleared: { label: 'Cleared', className: 'bg-pastel-mint text-pastel-mint-text border border-emerald-200' },
      archived: { label: 'Archived', className: 'bg-pastel-lavender text-pastel-lavender-text border border-violet-200' },
    };

    const config = statusConfig[status] || {
      label: status,
      className: 'bg-pastel-lavender text-pastel-lavender-text border border-violet-200',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  };

  return (
    <>
      <div className="min-h-screen bg-brand-background">
        <Header 
          title="Invoices" 
          subtitle="View and manage all freight invoices processed by the system."
        />
        
        <div className="page-transition mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Filters */}
          <div
            className="mb-6 flex flex-wrap gap-2"
            role="group"
            aria-label="Filter invoices by status"
          >
            {FILTER_BUTTONS.map(({ value, label, ariaLabel }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setFilter(value);
                  setPage(0);
                }}
                aria-label={ariaLabel}
                aria-pressed={filter === value}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus ${
                  filter === value
                    ? 'btn-brand-primary'
                    : 'bg-brand-surface text-brand-primary border border-brand-border hover:bg-brand-surface-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 bg-brand-destructive-soft border border-brand-border text-brand-destructive px-4 py-3 rounded-md">
              Failed to load invoices
            </div>
          )}

          {/* Invoices Table */}
          <div className="overflow-hidden rounded-lg border border-brand-border bg-brand-surface shadow-sm">
            {loading && !isPlaceholderData ? (
              <InvoicesSkeleton />
            ) : invoices.length === 0 ? (
              <div className="px-6 py-12 text-center text-brand-muted">
                <div className="mb-4 text-4xl" aria-hidden>📄</div>
                <p className="text-sm">No invoices found.</p>
                <p className="mt-2 text-xs">Connect your mailbox to start processing invoices.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-brand-border">
                    <thead className="bg-brand-surface-muted">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Invoice Number
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Carrier
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-brand-primary uppercase tracking-wider">
                          Findings
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border bg-brand-surface">
                      {invoices.map((invoice, index) => (
                        <tr
                          key={invoice.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`/invoices/${invoice.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              router.push(`/invoices/${invoice.id}`);
                            }
                          }}
                          aria-label={`View invoice ${invoice.invoice_number} from ${invoice.carrier_name}`}
                          className={`cursor-pointer transition-all duration-200 ${
                            index % 2 === 0 ? 'bg-brand-surface' : 'bg-brand-background'
                          } hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-border-focus`}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-normal text-brand-primary">{invoice.invoice_number}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-brand-primary">{invoice.carrier_name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-brand-muted">{formatDate(invoice.invoice_date)}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-brand-primary">
                              {formatCurrency(invoice.total_amount, invoice.currency)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(invoice.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {invoice.findings_count > 0 ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-pastel-rose text-pastel-rose-text border border-rose-200">
                                {invoice.findings_count}
                              </span>
                            ) : (
                              <span className="text-sm text-brand-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-brand-border px-6 py-4">
                    <p className="text-sm text-brand-muted">
                      Page {page + 1} of {totalPages} ({total} total)
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0 || loading}
                        aria-label="Go to previous page"
                        className="rounded-md border border-brand-border bg-brand-surface px-3 py-1.5 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1 || loading}
                        aria-label="Go to next page"
                        className="rounded-md border border-brand-border bg-brand-surface px-3 py-1.5 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
