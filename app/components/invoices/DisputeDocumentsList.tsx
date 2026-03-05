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

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
        <p className="mt-4 text-sm text-gray-500">Loading dispute documents...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md">
        {error}
      </div>
    );
  }

  if (disputes.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p className="text-sm">No dispute documents generated yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Dispute Documents</h3>
      <div className="space-y-3">
        {disputes.map((dispute) => (
          <div
            key={dispute.id}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => setSelectedDispute(dispute)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h4 className="text-sm font-medium text-gray-900">{dispute.filename}</h4>
                  {getStatusBadge(dispute.status)}
                </div>

                <div className="text-xs text-gray-500 space-y-1">
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
                    className="px-3 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
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
