'use client';

import { useState } from 'react';
import { CheckCircle2, ArrowDownLeft, ArrowUpRight, Send } from 'lucide-react';
import type { Dispute, DisputeMessage } from '@/lib/api/disputes';
import { sendDispute, updateDispute } from '@/lib/api/disputes';
import ResolveDisputeModal from './ResolveDisputeModal';

interface Finding {
  id: string;
  summary: string;
  delta_amount: number;
  amount_edited: number | null;
}

interface DisputeActivePanelProps {
  dispute: Dispute;
  messages: DisputeMessage[];
  findings: Finding[];
  onDisputeUpdated: (updated: Dispute) => void;
}

export default function DisputeActivePanel({
  dispute,
  messages,
  findings,
  onDisputeUpdated,
}: DisputeActivePanelProps) {
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [round2Letter, setRound2Letter] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptedFindingIds = findings
    .filter(f => !dispute.disputed_finding_ids.includes(f.id))
    .map(f => f.id);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleSendRound2 = async () => {
    if (!round2Letter.trim()) return;
    setSending(true);
    setError(null);
    try {
      await updateDispute(dispute.id, { draft_letter: round2Letter });
      const { dispute: updated } = await sendDispute(dispute.id, {
        recipient_email: dispute.recipient_email ?? undefined,
        recipient_name: dispute.recipient_name ?? undefined,
      });
      setRound2Letter('');
      onDisputeUpdated(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send follow-up');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Dispute History</h3>
          <button
            onClick={() => setShowResolveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark Resolved
          </button>
        </div>

        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`rounded-lg border p-4 ${
                msg.direction === 'outbound'
                  ? 'bg-indigo-50 border-indigo-200'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {msg.direction === 'outbound' ? (
                    <ArrowUpRight className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4 text-gray-600" />
                  )}
                  <span className="text-xs font-medium text-gray-700">
                    {msg.direction === 'outbound' ? 'Sent by you' : 'Carrier reply'}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{formatDate(msg.sent_at)}</span>
              </div>
              {msg.subject && (
                <p className="text-xs font-medium text-gray-600 mb-1">{msg.subject}</p>
              )}
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                {msg.body}
              </pre>
            </div>
          ))}
        </div>

        {dispute.status !== 'resolved' && (
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Send Follow-up</h4>
            <textarea
              value={round2Letter}
              onChange={e => setRound2Letter(e.target.value)}
              rows={8}
              placeholder="Write a follow-up letter if the carrier hasn't responded or you need to escalate..."
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
            />
            <button
              onClick={handleSendRound2}
              disabled={!round2Letter.trim() || sending}
              className="mt-2 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : 'Send Follow-up'}
            </button>
          </div>
        )}
      </div>

      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Findings</h3>
        <div className="space-y-2">
          {findings.map(f => {
            const isAccepted = acceptedFindingIds.includes(f.id);
            return (
              <div
                key={f.id}
                className={`flex justify-between items-start gap-2 ${isAccepted ? 'opacity-60' : ''}`}
              >
                <span className={`text-xs leading-snug ${isAccepted ? 'line-through text-green-700' : 'text-gray-700'}`}>
                  {f.summary}
                </span>
                <span className={`text-xs font-medium whitespace-nowrap ${isAccepted ? 'line-through text-green-600' : 'text-red-600'}`}>
                  ${(f.amount_edited ?? f.delta_amount).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-900">Total Disputed</span>
          <span className="text-sm font-bold text-red-600">
            ${dispute.total_disputed_amount.toFixed(2)}
          </span>
        </div>
      </div>

      {showResolveModal && (
        <ResolveDisputeModal
          dispute={dispute}
          onResolved={onDisputeUpdated}
          onClose={() => setShowResolveModal(false)}
        />
      )}
    </div>
  );
}
