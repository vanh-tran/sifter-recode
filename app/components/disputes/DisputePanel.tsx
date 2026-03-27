'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, AlertCircle } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import {
  fetchDisputeByInvoice,
  fetchDisputeWithMessages,
  createDraftDispute,
} from '@/lib/api/disputes';
import DisputeDraftPanel from './DisputeDraftPanel';
import DisputeActivePanel from './DisputeActivePanel';
import BillingEmailConfirmModal from './BillingEmailConfirmModal';

interface InvoiceForDispute {
  id: string;
  invoice_number: string;
  carrier: {
    id: string;
    name_normalized: string;
    billing_email: string | null;
    billing_email_confirmed: boolean;
  };
  findings: Array<{
    id: string;
    summary: string;
    delta_amount: number;
    amount_edited: number | null;
    is_approved: boolean;
  }>;
}

interface DisputePanelProps {
  invoice: InvoiceForDispute;
}

export default function DisputePanel({ invoice }: DisputePanelProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [showBillingConfirm, setShowBillingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: disputeStub, isLoading: loadingStub } = useQuery({
    queryKey: ['dispute-by-invoice', invoice.id],
    queryFn: () => fetchDisputeByInvoice(invoice.id),
    staleTime: 30_000,
  });

  const { data: disputeDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['dispute-detail', disputeStub?.id],
    queryFn: () => fetchDisputeWithMessages(disputeStub!.id),
    enabled: !!disputeStub?.id,
    staleTime: 15_000,
  });

  const approvedFindings = invoice.findings.filter(f => f.is_approved);

  const handleCreateDispute = async () => {
    setCreating(true);
    setError(null);
    try {
      await createDraftDispute(invoice.id, approvedFindings.map(f => f.id));
      queryClient.invalidateQueries({ queryKey: ['dispute-by-invoice', invoice.id] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start dispute');
    } finally {
      setCreating(false);
    }
  };

  const handleDisputeUpdated = (updated: Dispute) => {
    queryClient.setQueryData(['dispute-by-invoice', invoice.id], updated);
    queryClient.setQueryData(['dispute-detail', updated.id], (old: unknown) => {
      const oldData = old as { dispute: Dispute; messages: unknown[] } | undefined;
      return oldData ? { ...oldData, dispute: updated } : { dispute: updated, messages: [] };
    });
    if (['sent', 'carrier_replied', 'resolved'].includes(updated.status)) {
      queryClient.invalidateQueries({ queryKey: ['dispute-detail', updated.id] });
    }
  };

  const isLoading = loadingStub || (!!disputeStub && loadingDetail);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  if (!disputeStub) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-4">
        <FileText className="w-10 h-10 text-gray-300" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">No dispute opened yet</p>
          <p className="text-xs text-gray-500 mt-1">
            {approvedFindings.length} finding{approvedFindings.length !== 1 ? 's' : ''} approved
          </p>
        </div>
        <button
          onClick={handleCreateDispute}
          disabled={creating || approvedFindings.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? 'Starting\u2026' : 'Start Dispute'}
        </button>
        {approvedFindings.length === 0 && (
          <p className="text-xs text-amber-600">Approve at least one finding to start a dispute.</p>
        )}
      </div>
    );
  }

  const dispute = disputeDetail?.dispute ?? disputeStub;
  const messages = disputeDetail?.messages ?? [];

  if (dispute.status === 'draft') {
    return (
      <>
        <DisputeDraftPanel
          dispute={dispute}
          findings={invoice.findings}
          carrier={invoice.carrier}
          invoiceId={invoice.id}
          onDisputeUpdated={handleDisputeUpdated}
        />
        {showBillingConfirm && (
          <BillingEmailConfirmModal
            carrierName={invoice.carrier.name_normalized}
            billingEmail={invoice.carrier.billing_email ?? ''}
            onConfirm={async (confirmedEmail) => {
              await fetch(`/api/disputes/${dispute.id}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient_email: confirmedEmail }),
              });
              setShowBillingConfirm(false);
            }}
            onClose={() => setShowBillingConfirm(false)}
          />
        )}
      </>
    );
  }

  return (
    <DisputeActivePanel
      dispute={dispute}
      messages={messages}
      findings={invoice.findings}
      onDisputeUpdated={handleDisputeUpdated}
    />
  );
}
