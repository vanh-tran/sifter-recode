'use client';

import { useState } from 'react';
import EmailThreadView from './EmailThreadView';

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

interface DisputeDocumentDetailModalProps {
  dispute: DisputeDocument;
  onClose: () => void;
  onRefresh: () => void;
}

export default function DisputeDocumentDetailModal({
  dispute,
  onClose,
  onRefresh,
}: DisputeDocumentDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const [recipientEmail, setRecipientEmail] = useState(dispute.recipient_email || '');
  const [recipientName, setRecipientName] = useState(dispute.recipient_name || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');

  const handleViewPdf = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/disputes/${dispute.id}/pdf`);

      if (!response.ok) {
        throw new Error('Failed to get PDF URL');
      }

      const data = await response.json();

      if (data.pdf_url) {
        window.open(data.pdf_url, '_blank');
      }
    } catch {
      setError('Failed to view PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!recipientEmail) {
      setError('Recipient email is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/disputes/${dispute.id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient_email: recipientEmail,
          recipient_name: recipientName || null,
          subject: emailSubject || null,
          message: emailMessage || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send dispute email');
      }

      onRefresh();
      onClose();
    } catch {
      setError('Failed to send email');
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

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-brand-border bg-brand-surface shadow-xl">
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-brand-primary">Dispute document</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-brand-muted hover:text-brand-primary"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-md border border-brand-border bg-brand-destructive-soft p-3 text-sm text-brand-destructive">
                {error}
              </div>
            )}

            <div className="mb-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-brand-muted">Filename</label>
                <p className="text-sm text-brand-primary">{dispute.filename}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-brand-muted">Status</label>
                <div>{getStatusBadge(dispute.status)}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-brand-muted">Created</label>
                  <p className="text-sm text-brand-primary">{formatDate(dispute.created_at)}</p>
                </div>
                {dispute.email_sent_at && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-muted">Sent</label>
                    <p className="text-sm text-brand-primary">{formatDate(dispute.email_sent_at)}</p>
                  </div>
                )}
              </div>

              {dispute.recipient_email && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-brand-muted">Recipient</label>
                  <p className="text-sm text-brand-primary">
                    {dispute.recipient_name || dispute.recipient_email}
                    {dispute.recipient_name && (
                      <span className="ml-2 text-brand-muted">({dispute.recipient_email})</span>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-brand-border pt-6">
              <button
                type="button"
                onClick={handleViewPdf}
                disabled={loading}
                className="btn-brand-primary flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {loading ? 'Loading...' : 'View PDF'}
              </button>

              {dispute.status !== 'sent' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Recipient Email *
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      required
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                      placeholder="carrier@example.com"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Recipient Name
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                      placeholder="Carrier Name"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Email Subject
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                      placeholder="Dispute Letter - Invoice [Number]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Email Message
                    </label>
                    <textarea
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      rows={4}
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                      placeholder="Dear [Carrier],&#10;&#10;Please find attached our dispute letter..."
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSendEmail}
                    disabled={loading || !recipientEmail}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-success px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {loading ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              )}

              {dispute.status === 'sent' && (
                <button
                  type="button"
                  onClick={() => setShowEmailModal(true)}
                  className="btn-brand-primary flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  View Email Thread
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showEmailModal && (
        <EmailThreadView
          disputeDocumentId={dispute.id}
          onClose={() => setShowEmailModal(false)}
        />
      )}
    </>
  );
}
