// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });

import DisputeActivePanel from '@/app/components/disputes/DisputeActivePanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock ResolveDisputeModal since it's Task 7
vi.mock('@/app/components/disputes/ResolveDisputeModal', () => ({
  default: () => React.createElement('div', { 'data-testid': 'resolve-modal' }),
}));

const mockDispute = {
  id: 'dispute-1',
  status: 'sent' as const,
  draft_letter: 'Dear FastFreight,\n\nWe dispute the following...',
  disputed_finding_ids: ['f-1'],
  recipient_email: 'billing@fastfreight.com',
  recipient_name: 'Billing Team',
  total_disputed_amount: 214.50,
  email_thread_id: 'thread-abc',
  recovered_amount: null,
  resolved_at: null,
  invoice_id: 'inv-1',
  org_id: 'org-1',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const mockMessages = [
  {
    id: 'msg-1',
    dispute_id: 'dispute-1',
    direction: 'outbound' as const,
    from_email: null,
    to_emails: ['billing@fastfreight.com'],
    subject: 'Freight Invoice Dispute — Invoice INV-2024-001',
    body: 'Dear FastFreight,\n\nWe dispute the following...',
    email_message_id: 'gm-1',
    email_thread_id: 'thread-abc',
    sent_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
  },
];

const mockFindings = [
  { id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('DisputeActivePanel', () => {
  it('renders the outbound message in history', () => {
    render(
      React.createElement(DisputeActivePanel, {
        dispute: mockDispute,
        messages: mockMessages,
        findings: mockFindings,
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByText(/We dispute the following/)).toBeInTheDocument();
  });

  it('labels outbound messages as "Sent by you"', () => {
    render(
      React.createElement(DisputeActivePanel, {
        dispute: mockDispute,
        messages: mockMessages,
        findings: mockFindings,
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByText(/sent by you/i)).toBeInTheDocument();
  });

  it('shows Mark Resolved button', () => {
    render(
      React.createElement(DisputeActivePanel, {
        dispute: mockDispute,
        messages: mockMessages,
        findings: mockFindings,
        onDisputeUpdated: vi.fn(),
      }),
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument();
  });
});
