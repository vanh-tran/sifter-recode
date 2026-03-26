'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/app/components/Header';
import { useAuth } from '@/app/components/AuthProvider';
import FindingApprovalToggle from '@/app/components/invoices/FindingApprovalToggle';
import GenerateDisputeModal from '@/app/components/invoices/GenerateDisputeModal';
import DisputeDocumentsList from '@/app/components/invoices/DisputeDocumentsList';
import EditFindingModal from '@/app/components/invoices/EditFindingModal';
import {
  fetchInvoice as fetchInvoiceFromApi,
  type InvoiceDetail,
} from '@/lib/api/invoices';

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    new: {
      label: 'New',
      className:
        'bg-pastel-blue text-pastel-blue-text border border-sky-200/80 dark:border-sky-400/25',
    },
    reviewing: {
      label: 'Reviewing',
      className:
        'bg-pastel-amber text-pastel-amber-text border border-amber-200/80 dark:border-amber-400/25',
    },
    action_needed: {
      label: 'Action Needed',
      className:
        'bg-pastel-rose text-pastel-rose-text border border-rose-200/80 dark:border-rose-400/25',
    },
    cleared: {
      label: 'Cleared',
      className:
        'bg-pastel-mint text-pastel-mint-text border border-emerald-200/80 dark:border-emerald-400/25',
    },
    archived: {
      label: 'Archived',
      className:
        'bg-pastel-lavender text-pastel-lavender-text border border-violet-200/80 dark:border-violet-400/25',
    },
    no_findings: {
      label: 'No findings',
      className:
        'bg-brand-surface-muted text-brand-muted border border-brand-border',
    },
  };

  const config = statusConfig[status] || {
    label: status,
    className: 'bg-brand-surface-muted text-brand-muted border border-brand-border',
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
      {config.label}
    </span>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const invoiceId = params?.id as string;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [editingFinding, setEditingFinding] = useState<any | null>(null);
  const [fallbackPdfUrl, setFallbackPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const lastFetchedInvoiceIdRef = useRef<string | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastFetchedInvoiceIdRef.current !== null && lastFetchedInvoiceIdRef.current !== invoiceId) {
      setInvoice(null);
      setError(null);
      setFallbackPdfUrl(null);
      setPdfError(null);
    }

    const userId = user?.id || null;
    const shouldFetch =
      user &&
      invoiceId &&
      (lastFetchedInvoiceIdRef.current !== invoiceId || lastFetchedUserIdRef.current !== userId);

    if (shouldFetch) {
      lastFetchedInvoiceIdRef.current = invoiceId;
      lastFetchedUserIdRef.current = userId;
      fetchInvoice();
    } else if (!user) {
      setLoading(false);
    }
  }, [user?.id, invoiceId]);

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleFindingToggle = (findingId: string, isApproved: boolean) => {
    if (!invoice) return;
    setInvoice({
      ...invoice,
      findings: invoice.findings.map((f: any) =>
        f.id === findingId ? { ...f, is_approved: isApproved } : f
      ),
    });
  };

  const handleGenerateDispute = () => {
    if (!invoice || !user) return;
    const approvedFindings = invoice.findings.filter((f: any) => f.is_approved);
    if (approvedFindings.length === 0) {
      alert('Please approve at least one finding before generating a dispute document.');
      return;
    }
    setShowGenerateModal(true);
  };

  const handleDisputeSuccess = () => {
    if (invoiceId) fetchInvoice();
  };

  const loadPdfFallback = async () => {
    if (!invoiceId) return;
    setLoadingPdf(true);
    setFallbackPdfUrl(null);
    setPdfError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'PDF not found');
      }
      const data = await res.json();
      if (data.pdf_url) setFallbackPdfUrl(data.pdf_url);
      else setPdfError('PDF not available');
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to load PDF');
    } finally {
      setLoadingPdf(false);
    }
  };

  const fetchInvoice = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (!invoiceId) {
      setError('Invalid invoice ID');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await fetchInvoiceFromApi(invoiceId);
      setInvoice(data);
    } catch (err) {
      if (err instanceof Error && err.message === 'Invoice not found') {
        setError('Invoice not found');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load invoice');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-background">
        <Header title="Invoice details" />
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="py-12 text-center">
            <div
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-border border-t-[#4f8ef7]"
              aria-hidden
            />
            <p className="mt-4 text-sm text-brand-muted">Loading invoice…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-brand-background">
        <Header title="Invoice details" />
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-md border border-brand-border bg-brand-destructive-soft px-4 py-3 text-brand-destructive">
            {error || 'Invoice not found'}
          </div>
          <div className="mt-4">
            <Link
              href="/invoices"
              className="text-sm font-medium text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
            >
              ← Back to invoices
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const approvedCount = invoice.findings.filter((f: any) => f.is_approved).length;
  const totalSavings = invoice.findings.reduce(
    (sum: number, f: any) => sum + (f.estimated_savings || 0),
    0
  );

  return (
    <div className="min-h-screen bg-brand-background">
      <Header title={`Invoice ${invoice.invoice_number}`} subtitle={invoice.carrier.name_normalized} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href="/invoices"
            className="text-sm font-medium text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
          >
            ← Back to invoices
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* PDF */}
          <section className="lg:col-span-5">
            <div className="rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted">
                Original document
              </h3>
              {(invoice.document.pdf_url || fallbackPdfUrl) ? (
                <div className="overflow-hidden rounded-lg border border-brand-border">
                  <iframe
                    src={fallbackPdfUrl || invoice.document.pdf_url || ''}
                    className="w-full"
                    style={{ height: 'min(70vh, 800px)' }}
                    title="Invoice PDF"
                  />
                </div>
              ) : invoice.document.id ? (
                <div className="rounded-lg border border-brand-border bg-brand-surface-muted p-6">
                  <p className="mb-3 text-sm text-brand-muted">
                    PDF could not be loaded with the invoice. You can try loading it directly.
                  </p>
                  {pdfError && <p className="mb-3 text-sm text-brand-destructive">{pdfError}</p>}
                  <button
                    type="button"
                    onClick={loadPdfFallback}
                    disabled={loadingPdf}
                    className="btn-brand-primary rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {loadingPdf ? 'Loading…' : 'Load PDF'}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {/* Findings */}
          <section className="lg:col-span-4">
            <div className="rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-brand-primary">
                  Audit findings
                  {invoice.findings.length > 0 && (
                    <span className="ml-2 font-normal text-brand-muted">
                      ({invoice.findings.length})
                    </span>
                  )}
                </h3>
                {approvedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleGenerateDispute}
                    className="btn-brand-primary shrink-0 rounded-md px-3 py-1.5 text-xs font-medium"
                  >
                    Generate dispute ({approvedCount})
                  </button>
                )}
              </div>

              {invoice.findings.length === 0 ? (
                <p className="text-sm text-brand-muted">No findings for this invoice.</p>
              ) : (
                <>
                  <p className="mb-4 text-xs text-brand-muted">
                    Toggle findings to include them in the dispute. Edits apply to the dispute
                    draft only, not the AI output.
                  </p>
                  <div className="space-y-3">
                    {invoice.findings.map((finding: any) => (
                      <div
                        key={finding.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          finding.is_approved
                            ? 'border-[#4f8ef7]/60 bg-brand-surface-muted'
                            : 'border-brand-border bg-brand-background'
                        }`}
                      >
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                finding.severity === 'critical'
                                  ? 'bg-pastel-rose text-pastel-rose-text'
                                  : finding.severity === 'high'
                                    ? 'bg-pastel-amber text-pastel-amber-text'
                                    : 'bg-brand-surface-muted text-brand-muted'
                              }`}
                            >
                              {finding.severity}
                            </span>
                            <span className="rounded bg-pastel-blue px-1.5 py-0.5 text-[10px] font-medium text-pastel-blue-text">
                              {String(finding.leak_type || '').replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingFinding(finding)}
                              className="rounded border border-brand-border bg-brand-surface px-2 py-1 text-[10px] font-medium text-brand-primary hover:bg-brand-surface-muted"
                            >
                              Edit
                            </button>
                            <FindingApprovalToggle
                              findingId={finding.id}
                              isApproved={finding.is_approved || false}
                              onToggle={handleFindingToggle}
                            />
                          </div>
                        </div>
                        <p className="text-sm font-medium text-brand-primary">{finding.summary}</p>
                        <p className="mt-1 text-xs text-brand-muted">{finding.reasoning}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-brand-muted">
                          {finding.delta_amount != null && finding.delta_amount !== 0 && (
                            <span className={finding.delta_amount > 0 ? 'text-pastel-rose-text' : 'text-pastel-blue-text'}>
                              {finding.delta_amount > 0 ? 'Overcharge' : 'Delta'}:{' '}
                              {formatCurrency(Math.abs(finding.delta_amount), invoice.currency)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Rail */}
          <aside className="lg:col-span-3">
            <div className="space-y-4">
              <div className="rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
                  Summary
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <div>
                    <dt className="text-brand-muted">Status</dt>
                    <dd className="mt-0.5">{getStatusBadge(invoice.ui_status)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-muted">Invoice date</dt>
                    <dd className="text-brand-primary">{formatDate(invoice.invoice_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-muted">Carrier</dt>
                    <dd className="text-brand-primary">{invoice.carrier.name_normalized}</dd>
                  </div>
                  <div>
                    <dt className="text-brand-muted">Total</dt>
                    <dd className="text-lg font-bold tabular-nums text-brand-primary">
                      {formatCurrency(invoice.total_amount, invoice.currency)}
                    </dd>
                  </div>
                  {invoice.overcharge_amount != null && invoice.overcharge_amount > 0 && (
                    <div>
                      <dt className="text-brand-muted">Overcharge</dt>
                      <dd className="font-medium text-pastel-rose-text">
                        {formatCurrency(invoice.overcharge_amount, invoice.currency)}
                      </dd>
                    </div>
                  )}
                  {invoice.bol_pro && (
                    <div>
                      <dt className="text-brand-muted">BOL / PRO</dt>
                      <dd className="text-sm text-brand-primary">{invoice.bol_pro}</dd>
                    </div>
                  )}
                  {totalSavings > 0 && (
                    <div>
                      <dt className="text-brand-muted">Est. savings</dt>
                      <dd className="font-medium text-brand-success">
                        {formatCurrency(totalSavings, invoice.currency)}
                      </dd>
                    </div>
                  )}
                </dl>
                {approvedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleGenerateDispute}
                    className="btn-brand-primary mt-4 w-full rounded-md py-2 text-sm font-medium"
                  >
                    Open dispute flow
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Line items */}
        <div className="mt-6 overflow-hidden rounded-lg border border-brand-border bg-brand-surface shadow-sm">
          <div className="border-b border-brand-border px-4 py-3 sm:px-6">
            <h3 className="text-sm font-semibold text-brand-primary">Line items</h3>
          </div>
          {invoice.line_items.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-brand-muted">No line items.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-brand-border">
                <thead className="bg-brand-surface-muted">
                  <tr>
                    {(['Line', 'Code', 'Description', 'Qty', 'Unit', 'Rate', 'Amount'] as const).map(
                      (h) => (
                        <th
                          key={h}
                          className={`px-4 py-2 text-xs font-medium uppercase tracking-wider text-brand-muted ${
                            h === 'Amount' ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {invoice.line_items.map((item) => (
                    <tr key={item.id} className="bg-brand-surface">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-primary">
                        {item.line_number ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-primary">
                        {item.code ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-brand-primary">
                        {item.description}
                        {item.charge_type && (
                          <span className="ml-1 text-xs text-brand-muted">({item.charge_type})</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-primary">
                        {item.qty != null ? item.qty.toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-muted">
                        {item.unit ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-brand-primary">
                        {item.rate != null ? formatCurrency(item.rate, invoice.currency) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-brand-primary">
                        {formatCurrency(item.amount, invoice.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {invoice.references.length > 0 && (
          <div className="mt-6 rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm sm:p-6">
            <h3 className="mb-3 text-sm font-semibold text-brand-primary">References</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {invoice.references.map((ref) => (
                <div key={ref.id} className="rounded-md border border-brand-border p-3">
                  <div className="text-[10px] font-medium uppercase text-brand-muted">{ref.ref_type}</div>
                  <div className="mt-1 text-sm font-medium text-brand-primary">{ref.ref_value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-brand-border bg-brand-surface p-4 shadow-sm sm:p-6">
          <DisputeDocumentsList invoiceId={invoiceId} />
        </div>
      </div>

      {showGenerateModal && invoice && (
        <GenerateDisputeModal
          invoiceId={invoiceId}
          approvedFindings={invoice.findings.filter((f: any) => f.is_approved)}
          onClose={() => setShowGenerateModal(false)}
          onSuccess={handleDisputeSuccess}
        />
      )}

      {editingFinding && invoice && (
        <EditFindingModal
          finding={editingFinding}
          currency={invoice.currency}
          onClose={() => setEditingFinding(null)}
          onSuccess={() => {
            fetchInvoice();
            setEditingFinding(null);
          }}
        />
      )}
    </div>
  );
}
