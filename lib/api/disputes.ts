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
