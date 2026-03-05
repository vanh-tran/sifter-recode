'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface FindingApprovalToggleProps {
  findingId: string;
  isApproved: boolean;
  onToggle: (findingId: string, isApproved: boolean) => void;
}

export default function FindingApprovalToggle({
  findingId,
  isApproved,
  onToggle,
}: FindingApprovalToggleProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/findings/${findingId}/approve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_approved: !isApproved,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update finding approval');
      }

      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onToggle(findingId, !isApproved);
    } catch {
      setError('Failed to update approval');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-red-600" title={error}>
          ⚠️
        </span>
      )}
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={isApproved}
          onChange={handleToggle}
          disabled={loading}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
        <span className="ml-3 text-sm font-medium text-gray-700">
          {isApproved ? 'Approved' : 'Approve'}
        </span>
      </label>
      {loading && (
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
      )}
    </div>
  );
}
