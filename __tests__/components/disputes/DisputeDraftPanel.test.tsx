// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });
import DisputeDraftPanel from '@/app/components/disputes/DisputeDraftPanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockDispute = {
  id: 'dispute-1',
  status: 'draft' as const,
  draft_letter: 'Dear FastFreight,\n\nWe dispute the following charges...',
  disputed_finding_ids: ['f-1'],
  recipient_email: 'billing@fastfreight.com',
  recipient_name: 'Billing Team',
  total_disputed_amount: 214.50,
  invoice_id: 'inv-1',
  org_id: 'org-1',
  email_thread_id: null,
  recovered_amount: null,
  resolved_at: null,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const mockFindings = [
  { id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null },
  { id: 'f-2', summary: 'Fuel surcharge cap exceeded', delta_amount: 89.00, amount_edited: 89.00 },
];

const mockCarrier = {
  id: 'carrier-1',
  billing_email: 'billing@fastfreight.com',
  billing_email_confirmed: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('DisputeDraftPanel', () => {
  it('renders the letter textarea with existing draft_letter', () => {
    render(
      React.createElement(DisputeDraftPanel, {
        dispute: mockDispute,
        findings: mockFindings,
        carrier: mockCarrier,
        invoiceId: 'inv-1',
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByDisplayValue(/We dispute the following charges/)).toBeInTheDocument();
  });

  it('renders the recipient email field pre-populated', () => {
    render(
      React.createElement(DisputeDraftPanel, {
        dispute: mockDispute,
        findings: mockFindings,
        carrier: mockCarrier,
        invoiceId: 'inv-1',
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByDisplayValue('billing@fastfreight.com')).toBeInTheDocument();
  });

  it('shows total disputed amount', () => {
    render(
      React.createElement(DisputeDraftPanel, {
        dispute: mockDispute,
        findings: mockFindings,
        carrier: mockCarrier,
        invoiceId: 'inv-1',
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByText(/\$214\.50/)).toBeInTheDocument();
  });

  it('shows Send Dispute button', () => {
    render(
      React.createElement(DisputeDraftPanel, {
        dispute: mockDispute,
        findings: mockFindings,
        carrier: mockCarrier,
        invoiceId: 'inv-1',
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /send dispute/i })).toBeInTheDocument();
  });

  it('shows Regenerate button', () => {
    render(
      React.createElement(DisputeDraftPanel, {
        dispute: mockDispute,
        findings: mockFindings,
        carrier: mockCarrier,
        invoiceId: 'inv-1',
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });
});
