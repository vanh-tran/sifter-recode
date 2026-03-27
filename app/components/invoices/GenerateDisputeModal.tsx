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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-brand-border bg-brand-surface shadow-xl">
        <div className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-brand-primary">
              {step === 'generate' ? 'Generate Dispute Document' : 'Send Dispute Document'}
            </h2>
            <button
              onClick={onClose}
              type="button"
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

          {step === 'generate' && (
            <div className="space-y-4">
              <div>
                <p className="mb-4 text-sm text-brand-muted">
                  This will generate a PDF dispute document with {approvedFindings.length} approved finding(s).
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Recipient Email (Optional)
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="carrier@example.com"
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                    />
                    <p className="mt-1 text-xs text-brand-muted">
                      If provided, you can send the dispute document via email after generation.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-brand-primary">
                      Recipient Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Carrier Name"
                      className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-brand-border bg-brand-surface-muted px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-background"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="btn-brand-primary rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating ? 'Generating...' : 'Generate PDF'}
                </button>
              </div>
            </div>
          )}

          {step === 'send' && disputeDocumentId && (
            <div className="space-y-4">
              <div className="rounded-md border border-brand-border bg-brand-success-soft p-4">
                <p className="text-sm text-brand-success">
                  ✓ Dispute document generated successfully!
                </p>
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm font-medium text-[#4f8ef7] hover:underline dark:text-[#7dd3fc]"
                  >
                    View PDF →
                  </a>
                )}
              </div>

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
                    placeholder="Carrier Name"
                    className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
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
                    placeholder="Dispute Letter - Invoice [Number]"
                    className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-brand-primary">
                    Email Message
                  </label>
                  <textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={6}
                    placeholder="Dear [Carrier],&#10;&#10;Please find attached our dispute letter..."
                    className="input-brand w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4f8ef7]/40"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setStep('generate');
                    queryClient.invalidateQueries({ queryKey: ['invoices'] });
                    onSuccess();
                    onClose();
                  }}
                  className="rounded-md border border-brand-border bg-brand-surface-muted px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-background"
                >
                  Skip Email
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !recipientEmail}
                  className="btn-brand-primary rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
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
