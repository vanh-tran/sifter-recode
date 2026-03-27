'use client';

import { useState, useEffect } from 'react';
import EmailThreadView from './EmailThreadView';
import DisputeDocumentDetailModal from './DisputeDocumentDetailModal';

interface DisputeDocument {
  id: string;
  filename: string;
  status: string;
  recipient_email: string | null;
  recipient_name: string | null;
  email_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DisputeDocumentsListProps {
  invoiceId: string;
}

export default function DisputeDocumentsList({ invoiceId }: DisputeDocumentsListProps) {
  const [disputes, setDisputes] = useState<DisputeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingThreadId, setViewingThreadId] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<DisputeDocument | null>(null);

  useEffect(() => {
    fetchDisputes();
  }, [invoiceId]);

  const fetchDisputes = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/invoices/${invoiceId}/disputes`, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dispute documents');
      }

      const data = await response.json();
      setDisputes(data.dispute_documents || []);
    } catch {
      setError('Failed to load dispute documents');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: {
        label: 'Draft',
        className:
          'bg-brand-surface-muted text-brand-muted border border-brand-border',
      },
      generated: {
        label: 'Generated',
        className:
          'bg-pastel-blue text-pastel-blue-text border border-sky-200/80 dark:border-sky-400/25',
      },
      sent: {
        label: 'Sent',
        className:
          'bg-pastel-amber text-pastel-amber-text border border-amber-200/80 dark:border-amber-400/25',
      },
      acknowledged: {
        label: 'Acknowledged',
        className:
          'bg-pastel-mint text-pastel-mint-text border border-emerald-200/80 dark:border-emerald-400/25',
      },
      resolved: {
        label: 'Resolved',
        className:
          'bg-pastel-mint text-pastel-mint-text border border-emerald-200/80 dark:border-emerald-400/25',
      },
      cancelled: {
        label: 'Cancelled',
        className:
          'bg-pastel-rose text-pastel-rose-text border border-rose-200/80 dark:border-rose-400/25',
      },
    };

    const config = statusConfig[status] || {
      label: status,
      className: 'bg-brand-surface-muted text-brand-muted border border-brand-border',
    };
    return (
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${config.className}`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-border border-t-[#4f8ef7]" />
        <p className="mt-4 text-sm text-brand-muted">Loading dispute documents…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-destructive-soft px-4 py-3 text-brand-destructive">
        {error}
      </div>
    );
  }

  if (disputes.length === 0) {
    return (
      <div className="py-8 text-center text-brand-muted">
        <p className="text-sm">No dispute documents generated yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="mb-4 text-lg font-semibold text-brand-primary">Dispute documents</h3>
      <div className="space-y-3">
        {disputes.map((dispute) => (
          <div
            key={dispute.id}
            className="cursor-pointer rounded-lg border border-brand-border bg-brand-background p-4 transition-shadow hover:shadow-md"
            onClick={() => setSelectedDispute(dispute)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="mb-2 flex items-center gap-3">
                  <h4 className="text-sm font-medium text-brand-primary">{dispute.filename}</h4>
                  {getStatusBadge(dispute.status)}
                </div>

                <div className="space-y-1 text-xs text-brand-muted">
                  <p>Created: {formatDate(dispute.created_at)}</p>
                  {dispute.recipient_email && (
                    <p>Recipient: {dispute.recipient_name || dispute.recipient_email}</p>
                  )}
                  {dispute.email_sent_at && (
                    <p>Sent: {formatDate(dispute.email_sent_at)}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {dispute.status === 'sent' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingThreadId(dispute.id);
                    }}
                    className="px-3 py-1 text-xs font-medium text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
                  >
                    View Thread
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedDispute && (
        <DisputeDocumentDetailModal
          dispute={selectedDispute}
          onClose={() => setSelectedDispute(null)}
          onRefresh={fetchDisputes}
        />
      )}

      {viewingThreadId && (
        <EmailThreadView
          disputeDocumentId={viewingThreadId}
          onClose={() => setViewingThreadId(null)}
        />
      )}
    </div>
  );
}
