// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

afterEach(() => { cleanup(); });

vi.mock('@/lib/api/disputes', () => ({
  fetchDisputeByInvoice: vi.fn(),
  fetchDisputeWithMessages: vi.fn(),
  createDraftDispute: vi.fn(),
}));

vi.mock('@/app/components/disputes/DisputeDraftPanel', () => ({
  default: () => React.createElement('div', { 'data-testid': 'draft-panel' }, 'Dispute Letter'),
}));

vi.mock('@/app/components/disputes/DisputeActivePanel', () => ({
  default: () => React.createElement('div', { 'data-testid': 'active-panel' }),
}));

vi.mock('@/app/components/disputes/BillingEmailConfirmModal', () => ({
  default: () => null,
}));

const { fetchDisputeByInvoice, fetchDisputeWithMessages } = await import('@/lib/api/disputes') as any;

import DisputePanel from '@/app/components/disputes/DisputePanel';

const mockInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-2024-001',
  carrier: { id: 'carrier-1', name_normalized: 'FastFreight', billing_email: null, billing_email_confirmed: false },
  findings: [{ id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null, is_approved: true }],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('DisputePanel', () => {
  it('shows "Start Dispute" when no dispute exists', async () => {
    fetchDisputeByInvoice.mockResolvedValue(null);

    render(
      React.createElement(DisputePanel, { invoice: mockInvoice as any }),
      { wrapper }
    );

    expect(await screen.findByRole('button', { name: /start dispute/i })).toBeInTheDocument();
  });

  it('shows draft panel when dispute is in draft', async () => {
    fetchDisputeByInvoice.mockResolvedValue({
      id: 'dispute-1',
      status: 'draft',
      draft_letter: '',
      disputed_finding_ids: ['f-1'],
      total_disputed_amount: 125.50,
      recipient_email: null,
      recipient_name: null,
    });
    fetchDisputeWithMessages.mockResolvedValue({
      dispute: {
        id: 'dispute-1',
        status: 'draft',
        draft_letter: '',
        disputed_finding_ids: ['f-1'],
        total_disputed_amount: 125.50,
        recipient_email: null,
        recipient_name: null,
      },
      messages: [],
    });

    render(
      React.createElement(DisputePanel, { invoice: mockInvoice as any }),
      { wrapper }
    );

    expect(await screen.findByText(/dispute letter/i)).toBeInTheDocument();
  });
});
