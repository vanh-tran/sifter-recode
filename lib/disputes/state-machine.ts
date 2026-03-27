export type DisputeStatus = 'draft' | 'sent' | 'carrier_replied' | 'resolved';

export const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  draft: ['sent', 'draft'],
  sent: ['carrier_replied', 'resolved'],
  carrier_replied: ['resolved', 'sent'],
  resolved: [],
};

export function assertTransition(from: DisputeStatus, to: DisputeStatus): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ')}]`
    );
  }
}

export function canEdit(status: DisputeStatus): boolean {
  return status === 'draft';
}
