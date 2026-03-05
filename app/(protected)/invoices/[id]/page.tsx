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
  
  // Track the last fetched invoiceId to prevent unnecessary re-fetches
  const lastFetchedInvoiceIdRef = useRef<string | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Clear previous invoice data when invoiceId changes
    if (lastFetchedInvoiceIdRef.current !== null && lastFetchedInvoiceIdRef.current !== invoiceId) {
      setInvoice(null);
      setError(null);
      setFallbackPdfUrl(null);
      setPdfError(null);
    }

    // Only fetch if:
    // 1. We have a user
    // 2. We have an invoiceId
    // 3. Either the invoiceId changed OR the user ID changed (not just the user object reference)
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
      // If user is null, clear loading state
      setLoading(false);
    }
  }, [user?.id, invoiceId]); // Use user?.id instead of user to avoid re-fetches on object reference changes

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
    
    // Update local state
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
    // Refresh invoice data to get updated dispute documents
    if (invoiceId) {
      fetchInvoice();
    }
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

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      new: { label: 'New', className: 'bg-blue-100 text-blue-800' },
      reviewing: { label: 'Reviewing', className: 'bg-yellow-100 text-yellow-800' },
      action_needed: { label: 'Action Needed', className: 'bg-red-100 text-red-800' },
      cleared: { label: 'Cleared', className: 'bg-green-100 text-green-800' },
      archived: { label: 'Archived', className: 'bg-gray-100 text-gray-800' },
    };

    const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`px-3 py-1 text-sm font-medium rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Invoice Details" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-sm text-gray-500">Loading invoice...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Invoice Details" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md">
            {error || 'Invoice not found'}
          </div>
          <div className="mt-4">
            <Link href="/invoices" className="text-indigo-600 hover:text-indigo-900">
              ← Back to Invoices
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="min-h-screen bg-gray-50">
        <Header 
          title={`Invoice ${invoice.invoice_number}`}
          subtitle={invoice.carrier.name_normalized}
        />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back Link */}
          <div className="mb-6">
            <Link href="/invoices" className="text-indigo-600 hover:text-indigo-900 text-sm font-medium">
              ← Back to Invoices
            </Link>
          </div>

          {/* Invoice Header Card */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Information</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Invoice Number</dt>
                    <dd className="mt-1 text-sm text-gray-900">{invoice.invoice_number}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Invoice Date</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatDate(invoice.invoice_date)}</dd>
                  </div>
                  {invoice.due_date && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Due Date</dt>
                      <dd className="mt-1 text-sm text-gray-900">{formatDate(invoice.due_date)}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Status</dt>
                    <dd className="mt-1">{getStatusBadge(invoice.ui_status)}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Carrier Information</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Carrier Name</dt>
                    <dd className="mt-1 text-sm text-gray-900">{invoice.carrier.name_normalized}</dd>
                    {invoice.carrier.name_raw !== invoice.carrier.name_normalized && (
                      <dd className="mt-1 text-xs text-gray-500">({invoice.carrier.name_raw})</dd>
                    )}
                  </div>
                  {invoice.carrier.scac && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">SCAC</dt>
                      <dd className="mt-1 text-sm text-gray-900">{invoice.carrier.scac}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex justify-between items-end">
                <div className="space-y-2">
                  {invoice.subtotal_amount !== null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal: {formatCurrency(invoice.subtotal_amount, invoice.currency)}</span>
                    </div>
                  )}
                  {invoice.tax_amount !== null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Tax:</span>
                      <span className="text-gray-900">{formatCurrency(invoice.tax_amount, invoice.currency)}</span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600 mb-1">Total Amount</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {formatCurrency(invoice.total_amount, invoice.currency)}
                  </div>
                </div>
              </div>
              {invoice.payment_terms_text && (
                <div className="mt-4 text-sm text-gray-600">
                  <span className="font-medium">Payment Terms:</span> {invoice.payment_terms_text}
                </div>
              )}
            </div>

            {/* PDF Embed */}
            {(invoice.document.pdf_url || fallbackPdfUrl || invoice.document.id) && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Original Document</h3>
                {(invoice.document.pdf_url || fallbackPdfUrl) ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* No sandbox: Chrome/WebKit block PDF rendering in sandboxed iframes (WebKit #118859).
                        PDFs are from our GCS with signed URLs; content-type is validated server-side. */}
                    <iframe
                      src={fallbackPdfUrl || invoice.document.pdf_url || ''}
                      className="w-full"
                      style={{ height: '800px' }}
                      title="Invoice PDF"
                    />
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                    <p className="text-sm text-gray-600 mb-3">
                      PDF could not be loaded with the invoice. You can try loading it directly.
                    </p>
                    {pdfError && (
                      <p className="text-sm text-red-600 mb-3">{pdfError}</p>
                    )}
                    <button
                      type="button"
                      onClick={loadPdfFallback}
                      disabled={loadingPdf}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {loadingPdf ? 'Loading...' : 'Load PDF'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* References */}
          {invoice.references.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">References</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {invoice.references.map((ref) => (
                  <div key={ref.id} className="border border-gray-200 rounded-md p-3">
                    <div className="text-xs font-medium text-gray-500 uppercase">{ref.ref_type}</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">{ref.ref_value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Line Items */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Line Items</h3>
            </div>
            {invoice.line_items.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">
                <p className="text-sm">No line items found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Line
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Code
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Qty
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Unit
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Rate
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {invoice.line_items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.line_number || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.code || '—'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {item.description}
                          {item.charge_type && (
                            <span className="ml-2 text-xs text-gray-500">({item.charge_type})</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.qty !== null ? item.qty.toLocaleString() : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.unit || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.rate !== null ? formatCurrency(item.rate, invoice.currency) : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                          {formatCurrency(item.amount, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                        Total:
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-900">
                        {formatCurrency(invoice.total_amount, invoice.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Audit Findings */}
          {invoice.findings.length > 0 && (
            <div className="mt-6 bg-yellow-50 rounded-lg border border-yellow-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-yellow-900">
                  Audit Findings ({invoice.findings.length})
                </h3>
                <div className="flex items-center gap-4">
                  {invoice.findings.reduce((sum: number, f: any) => sum + (f.estimated_savings || 0), 0) > 0 && (
                    <span className="text-sm font-medium text-green-700">
                      Est. Savings: {formatCurrency(
                        invoice.findings.reduce((sum: number, f: any) => sum + (f.estimated_savings || 0), 0),
                        invoice.currency
                      )}
                    </span>
                  )}
                  {invoice.findings.filter((f: any) => f.is_approved).length > 0 && (
                    <button
                      onClick={handleGenerateDispute}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
                    >
                      Generate Dispute ({invoice.findings.filter((f: any) => f.is_approved).length} approved)
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-4 text-sm text-yellow-800">
                <p>Toggle findings on/off to include them in the dispute document.</p>
                <p className="mt-1">
                  Approved: {invoice.findings.filter((f: any) => f.is_approved).length} / {invoice.findings.length}
                </p>
              </div>
              <div className="space-y-4">
                {invoice.findings.map((finding: any) => (
                  <div key={finding.id} className={`bg-white rounded-md p-4 border-2 ${
                    finding.is_approved ? 'border-indigo-500 bg-indigo-50' : 'border-yellow-200'
                  }`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          finding.severity === 'critical' ? 'bg-red-100 text-red-800' :
                          finding.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                          finding.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {finding.severity}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                          {finding.leak_type.replace(/_/g, ' ')}
                        </span>
                        {finding.confidence !== null && (
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                            Confidence: {(finding.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        {finding.is_approved && (
                          <span className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded">
                            ✓ Approved
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setEditingFinding(finding)}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          title="Edit finding"
                        >
                          <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        <FindingApprovalToggle
                          findingId={finding.id}
                          isApproved={finding.is_approved || false}
                          onToggle={handleFindingToggle}
                        />
                      </div>
                    </div>
                    <div className="text-sm font-medium text-gray-900 mb-2">{finding.summary}</div>
                    <div className="text-sm text-gray-600 mb-3">{finding.reasoning}</div>
                    <div className="flex items-center gap-4 text-sm">
                      {finding.expected_amount !== null && (
                        <span className="text-gray-600">
                          <span className="font-medium">Expected:</span> {formatCurrency(finding.expected_amount, invoice.currency)}
                        </span>
                      )}
                      {finding.charged_amount !== null && (
                        <span className="text-gray-600">
                          <span className="font-medium">Charged:</span> {formatCurrency(finding.charged_amount, invoice.currency)}
                        </span>
                      )}
                      {finding.delta_amount !== 0 && (
                        <span className={`font-medium ${finding.delta_amount > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {finding.delta_amount > 0 ? 'Overcharge' : 'Undercharge'}: {formatCurrency(Math.abs(finding.delta_amount), invoice.currency)}
                        </span>
                      )}
                      {finding.estimated_savings && finding.estimated_savings > 0 && (
                        <span className="text-green-600 font-medium">
                          Savings: {formatCurrency(finding.estimated_savings, invoice.currency)}
                        </span>
                      )}
                    </div>
                    {finding.proof_required && (
                      <div className="mt-2 text-xs text-orange-600">
                        ⚠️ {finding.required_proof_description || 'Proof required'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dispute Documents List */}
          <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <DisputeDocumentsList invoiceId={invoiceId} />
          </div>
        </div>

        {/* Generate Dispute Modal */}
        {showGenerateModal && invoice && (
          <GenerateDisputeModal
            invoiceId={invoiceId}
            approvedFindings={invoice.findings.filter((f: any) => f.is_approved)}
            onClose={() => setShowGenerateModal(false)}
            onSuccess={handleDisputeSuccess}
          />
        )}

        {/* Edit Finding Modal */}
        {editingFinding && invoice && (
          <EditFindingModal
            finding={editingFinding}
            currency={invoice.currency}
            onClose={() => setEditingFinding(null)}
            onSuccess={() => {
              // Refetch invoice data to get updated finding
              fetchInvoice();
              setEditingFinding(null);
            }}
          />
        )}
      </div>
  );
}