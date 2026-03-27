'use client';

import { useState } from 'react';
import { CheckCircle2, DollarSign } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import { resolveDispute } from '@/lib/api/disputes';

interface ResolveDisputeModalProps {
  dispute: Dispute;
  onResolved: (updated: Dispute) => void;
  onClose: () => void;
}

export default function ResolveDisputeModal({
  dispute,
  onResolved,
  onClose,
}: ResolveDisputeModalProps) {
  const [amount, setAmount] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount);
  const isValid = amount.trim() !== '' && !isNaN(parsedAmount) && parsedAmount >= 0;

  const handleConfirm = async () => {
    if (!isValid) return;
    setResolving(true);
    setError(null);
    try {
      const updated = await resolveDispute(dispute.id, parsedAmount);
      onResolved(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to resolve dispute');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-50 rounded-full">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Mark Dispute Resolved</h3>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4">
          Enter the amount actually recovered. This will archive the invoice and close the dispute.
          Total originally disputed:{' '}
          <strong className="text-gray-900">${dispute.total_disputed_amount.toFixed(2)}</strong>
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Amount Recovered (USD)
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Enter 0 if no recovery was obtained. Enter the full amount or partial credit received.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={resolving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || resolving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" />
            {resolving ? 'Resolving\u2026' : 'Confirm Resolution'}
          </button>
        </div>
      </div>
    </div>
  );
}
