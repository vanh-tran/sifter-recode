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
        <span className="text-xs text-brand-destructive" title={error}>
          ⚠️
        </span>
      )}
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={isApproved}
          onChange={handleToggle}
          disabled={loading}
          className="peer sr-only"
        />
        <div className="peer h-6 w-11 rounded-full bg-brand-surface-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#4f8ef7]/30 peer-checked:bg-[#4f8ef7] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-brand-border after:bg-brand-surface after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-transparent"></div>
        <span className="ml-3 text-sm font-medium text-brand-primary">
          {isApproved ? 'Approved' : 'Approve'}
        </span>
      </label>
      {loading && (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-border border-t-[#4f8ef7]" />
      )}
    </div>
  );
}
