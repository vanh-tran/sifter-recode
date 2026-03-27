'use client';

import DisputePanel from '@/app/components/disputes/DisputePanel';

interface Dispute {
  id: string;
  disputed_finding_ids: string[];
  status: string;
}

interface InvoiceForDisputePanel {
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

interface Props {
  invoiceId: string;
  dispute: Dispute | null;
  selectedFindingIds: string[];
  disputeTotal: number;
  onOpenDispute: () => void;
  onApprove: () => void;
  /** Full invoice data needed to render the DisputePanel section. Optional for backward compat. */
  invoiceForDispute?: InvoiceForDisputePanel;
}

export default function InvoiceRightPanel({
  dispute,
  selectedFindingIds,
  disputeTotal,
  onOpenDispute,
  onApprove,
  invoiceForDispute,
}: Props) {
  const formatAmount = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const hasActiveDispute = dispute && ['sent', 'carrier_replied'].includes(dispute.status);
  const canApprove = !hasActiveDispute;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-brand-border bg-brand-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-primary">Dispute Summary</h3>
        {selectedFindingIds.length > 0 ? (
          <p className="mt-1 text-sm text-brand-muted">
            {selectedFindingIds.length} finding{selectedFindingIds.length !== 1 ? 's' : ''} selected
            {' — '}<span className="font-medium text-pastel-rose-text">{formatAmount(disputeTotal)}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-brand-muted">No findings selected</p>
        )}
      </div>

      {dispute && (
        <div className="rounded border border-brand-border bg-brand-background px-3 py-2 text-xs">
          <span className="font-medium">Dispute status: </span>
          <span className="capitalize">{dispute.status.replace(/_/g, ' ')}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenDispute}
          disabled={selectedFindingIds.length === 0}
          className="w-full rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {dispute ? 'Edit Dispute' : 'Open Dispute'}
        </button>

        {canApprove && (
          <button
            type="button"
            onClick={onApprove}
            className="w-full rounded-md border border-brand-border bg-brand-background px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-surface-muted"
          >
            Approve Invoice
          </button>
        )}
      </div>

      {invoiceForDispute && (
        <section className="border-t border-brand-border pt-4 mt-2">
          <h2 className="text-sm font-semibold text-brand-primary mb-3">Dispute</h2>
          <DisputePanel invoice={invoiceForDispute} />
        </section>
      )}
    </div>
  );
}
