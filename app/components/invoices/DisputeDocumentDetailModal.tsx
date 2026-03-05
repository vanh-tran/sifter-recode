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
      draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800' },
      generated: { label: 'Generated', className: 'bg-blue-100 text-blue-800' },
      sent: { label: 'Sent', className: 'bg-yellow-100 text-yellow-800' },
      acknowledged: { label: 'Acknowledged', className: 'bg-green-100 text-green-800' },
      resolved: { label: 'Resolved', className: 'bg-green-100 text-green-800' },
      cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
    };

    const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
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
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Dispute Document</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="mb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Filename</label>
                <p className="text-sm text-gray-900">{dispute.filename}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <div>{getStatusBadge(dispute.status)}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Created</label>
                  <p className="text-sm text-gray-900">{formatDate(dispute.created_at)}</p>
                </div>
                {dispute.email_sent_at && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sent</label>
                    <p className="text-sm text-gray-900">{formatDate(dispute.email_sent_at)}</p>
                  </div>
                )}
              </div>

              {dispute.recipient_email && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
                  <p className="text-sm text-gray-900">
                    {dispute.recipient_name || dispute.recipient_email}
                    {dispute.recipient_name && (
                      <span className="text-gray-500 ml-2">({dispute.recipient_email})</span>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 pt-6 space-y-3">
              <button
                onClick={handleViewPdf}
                disabled={loading}
                className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Recipient Email *
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="carrier@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Recipient Name
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Carrier Name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Subject
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Dispute Letter - Invoice [Number]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Message
                    </label>
                    <textarea
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Dear [Carrier],&#10;&#10;Please find attached our dispute letter..."
                    />
                  </div>

                  <button
                    onClick={handleSendEmail}
                    disabled={loading || !recipientEmail}
                    className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  onClick={() => setShowEmailModal(true)}
                  className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 flex items-center justify-center gap-2"
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
