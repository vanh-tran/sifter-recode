'use client';

import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import { updateDispute, generateLetter, sendDispute } from '@/lib/api/disputes';

interface Finding {
  id: string;
  summary: string;
  delta_amount: number;
  amount_edited: number | null;
}

interface Carrier {
  id: string;
  billing_email: string | null;
  billing_email_confirmed: boolean;
}

interface DisputeDraftPanelProps {
  dispute: Dispute;
  findings: Finding[];
  carrier: Carrier;
  invoiceId: string;
  onDisputeUpdated: (updated: Dispute) => void;
}

export default function DisputeDraftPanel({
  dispute,
  findings,
  carrier,
  invoiceId: _invoiceId,
  onDisputeUpdated,
}: DisputeDraftPanelProps) {
  const [letter, setLetter] = useState(dispute.draft_letter ?? '');
  const [recipientEmail, setRecipientEmail] = useState(dispute.recipient_email ?? carrier.billing_email ?? '');
  const [recipientName, setRecipientName] = useState(dispute.recipient_name ?? '');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFindings = findings.filter(f => dispute.disputed_finding_ids.includes(f.id));
  const totalDisputed = selectedFindings.reduce(
    (sum, f) => sum + (f.amount_edited ?? f.delta_amount),
    0
  );

  const handleLetterBlur = async () => {
    if (letter === dispute.draft_letter) return;
    setSaving(true);
    try {
      const updated = await updateDispute(dispute.id, { draft_letter: letter });
      onDisputeUpdated(updated);
    } catch {
      setError('Failed to save letter changes');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { dispute: updated, letter: newLetter } = await generateLetter(dispute.id);
      setLetter(newLetter);
      onDisputeUpdated(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate letter');
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      setError('Recipient email is required');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { dispute: updated } = await sendDispute(dispute.id, {
        recipient_email: recipientEmail,
        recipient_name: recipientName || undefined,
      });
      onDisputeUpdated(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send dispute');
    } finally {
      setSending(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 flex flex-col gap-3">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Dispute Letter</h3>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-gray-500">Saving…</span>}
            <button
              onClick={handleRegenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>

        <textarea
          value={letter}
          onChange={e => setLetter(e.target.value)}
          onBlur={handleLetterBlur}
          rows={16}
          placeholder="Click 'Regenerate' to generate an AI dispute letter from your selected findings."
          className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recipient Email *
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              placeholder="billing@carrier.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recipient Name
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              placeholder="Billing Team"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          disabled={!letter.trim() || !recipientEmail.trim() || sending}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          Send Dispute
        </button>
      </div>

      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Disputed Charges</h3>
        <p className="text-xs text-gray-500 mb-3">
          Total disputed:{' '}
          <span className="font-semibold text-red-600">
            ${dispute.total_disputed_amount.toFixed(2)}
          </span>
        </p>
        <div className="space-y-2">
          {selectedFindings.length === 0 ? (
            <p className="text-xs text-gray-500">No findings selected.</p>
          ) : (
            selectedFindings.map(f => (
              <div key={f.id} className="flex justify-between items-start gap-2">
                <span className="text-xs text-gray-700 leading-snug">{f.summary}</span>
                <span className="text-xs font-medium text-red-600 whitespace-nowrap">
                  ${(f.amount_edited ?? f.delta_amount).toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
        {selectedFindings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-900">Total</span>
            <span className="text-sm font-bold text-red-600">${totalDisputed.toFixed(2)}</span>
          </div>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Send</h3>
            <p className="text-sm text-gray-600 mb-1">
              Send dispute letter to <strong>{recipientEmail}</strong>?
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Total disputed: <strong className="text-red-600">${totalDisputed.toFixed(2)}</strong>
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={sending}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
