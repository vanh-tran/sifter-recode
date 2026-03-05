'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface GenerateDisputeModalProps {
  invoiceId: string;
  approvedFindings: any[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function GenerateDisputeModal({
  invoiceId,
  approvedFindings,
  onClose,
  onSuccess,
}: GenerateDisputeModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'generate' | 'send'>('generate');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [disputeDocumentId, setDisputeDocumentId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/disputes/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approved_finding_ids: approvedFindings.map((f: any) => f.id),
          recipient_email: recipientEmail || null,
          recipient_name: recipientName || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate dispute document');
      }

      const data = await response.json();
      setDisputeDocumentId(data.dispute_document?.id || null);
      setPdfUrl(data.pdf_url);

      if (recipientEmail) {
        setStep('send');
      } else {
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        onSuccess();
        onClose();
      }
    } catch {
      setError('Failed to generate dispute document');
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!disputeDocumentId) {
      setError('Dispute document not generated yet');
      return;
    }

    if (!recipientEmail) {
      setError('Recipient email is required');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/disputes/${disputeDocumentId}/send`, {
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

      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onSuccess();
      onClose();
    } catch {
      setError('Failed to send dispute email');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              {step === 'generate' ? 'Generate Dispute Document' : 'Send Dispute Document'}
            </h2>
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

          {step === 'generate' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  This will generate a PDF dispute document with {approvedFindings.length} approved finding(s).
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Recipient Email (Optional)
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="carrier@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      If provided, you can send the dispute document via email after generation.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Recipient Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Carrier Name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? 'Generating...' : 'Generate PDF'}
                </button>
              </div>
            </div>
          )}

          {step === 'send' && disputeDocumentId && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800">
                  ✓ Dispute document generated successfully!
                </p>
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    View PDF →
                  </a>
                )}
              </div>

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
                    placeholder="Carrier Name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    placeholder="Dispute Letter - Invoice [Number]"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Message
                  </label>
                  <textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={6}
                    placeholder="Dear [Carrier],&#10;&#10;Please find attached our dispute letter..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => {
                    setStep('generate');
                    queryClient.invalidateQueries({ queryKey: ['invoices'] });
                    onSuccess();
                    onClose();
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Skip Email
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending || !recipientEmail}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
