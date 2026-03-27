// lib/api/disputes.ts
export type DisputeStatus = 'draft' | 'sent' | 'carrier_replied' | 'resolved';

export interface Dispute {
  id: string;
  invoice_id: string;
  org_id: string;
  status: DisputeStatus;
  disputed_finding_ids: string[];
  total_disputed_amount: number;
  draft_letter: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  email_thread_id: string | null;
  recovered_amount: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  direction: 'outbound' | 'inbound';
  from_email: string | null;
  to_emails: string[];
  subject: string | null;
  body: string;
  email_message_id: string | null;
  email_thread_id: string | null;
  sent_at: string;
  created_at: string;
}

export async function fetchDisputesList(scope: 'active' | 'resolved' | 'all' = 'active') {
  const res = await fetch(`/api/disputes?scope=${scope}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to load disputes');
  return res.json();
}

export async function patchDispute(disputeId: string, body: { disputed_finding_ids: string[] }) {
  const res = await fetch(`/api/disputes/${disputeId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to update dispute');
  return res.json();
}

export async function createDisputeForInvoice(invoiceId: string) {
  const res = await fetch(`/api/invoices/${invoiceId}/disputes`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('Failed to create dispute');
  const j = (await res.json()) as { dispute: unknown; already_exists?: boolean };
  return j.dispute;
}

export async function fetchDisputeByInvoice(invoiceId: string): Promise<Dispute | null> {
  const res = await fetch(`/api/invoices/${invoiceId}/disputes`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch dispute');
  const data = await res.json();
  return data.dispute ?? null;
}

export async function fetchDisputeWithMessages(
  disputeId: string
): Promise<{ dispute: Dispute; messages: DisputeMessage[] }> {
  const res = await fetch(`/api/disputes/${disputeId}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to fetch dispute');
  return res.json();
}

export async function createDraftDispute(
  invoiceId: string,
  disputedFindingIds: string[]
): Promise<Dispute> {
  const res = await fetch(`/api/invoices/${invoiceId}/disputes/create`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disputed_finding_ids: disputedFindingIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'Failed to create dispute');
  }
  const data = await res.json();
  return data.dispute;
}

export async function updateDispute(
  disputeId: string,
  patch: Partial<Pick<Dispute, 'draft_letter' | 'disputed_finding_ids' | 'recipient_email' | 'recipient_name' | 'total_disputed_amount'>>
): Promise<Dispute> {
  const res = await fetch(`/api/disputes/${disputeId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update dispute');
  const data = await res.json();
  return data.dispute;
}

export async function generateLetter(disputeId: string): Promise<{ dispute: Dispute; letter: string }> {
  const res = await fetch(`/api/disputes/${disputeId}/generate-letter`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('Failed to generate letter');
  return res.json();
}

export async function sendDispute(
  disputeId: string,
  opts: { recipient_email?: string; recipient_name?: string; subject?: string }
): Promise<{ dispute: Dispute; thread_id: string }> {
  const res = await fetch(`/api/disputes/${disputeId}/send`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? 'Failed to send dispute');
  }
  return res.json();
}

export async function resolveDispute(
  disputeId: string,
  recoveredAmount: number
): Promise<Dispute> {
  const res = await fetch(`/api/disputes/${disputeId}/resolve`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recovered_amount: recoveredAmount }),
  });
  if (!res.ok) throw new Error('Failed to resolve dispute');
  const data = await res.json();
  return data.dispute;
}
