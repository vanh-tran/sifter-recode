// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });
import ResolveDisputeModal from '@/app/components/disputes/ResolveDisputeModal';
import React from 'react';

vi.mock('@/lib/api/disputes', () => ({
  resolveDispute: vi.fn(),
}));

const { resolveDispute } = await import('@/lib/api/disputes') as any;

const mockDispute = {
  id: 'dispute-1',
  status: 'sent' as const,
  total_disputed_amount: 214.50,
  invoice_id: 'inv-1',
  org_id: 'org-1',
  disputed_finding_ids: [],
  draft_letter: null,
  recipient_email: null,
  recipient_name: null,
  email_thread_id: null,
  recovered_amount: null,
  resolved_at: null,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

describe('ResolveDisputeModal', () => {
  it('renders the total disputed amount as a hint', () => {
    render(
      React.createElement(ResolveDisputeModal, {
        dispute: mockDispute,
        onResolved: vi.fn(),
        onClose: vi.fn(),
      })
    );
    expect(screen.getByText(/\$214\.50/)).toBeInTheDocument();
  });

  it('calls resolveDispute with parsed amount on confirm', async () => {
    resolveDispute.mockResolvedValueOnce({ ...mockDispute, status: 'resolved', recovered_amount: 150 });

    const onResolved = vi.fn();
    render(
      React.createElement(ResolveDisputeModal, {
        dispute: mockDispute,
        onResolved,
        onClose: vi.fn(),
      })
    );

    const input = screen.getByPlaceholderText(/0\.00/);
    fireEvent.change(input, { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm resolution/i }));

    await waitFor(() => {
      expect(resolveDispute).toHaveBeenCalledWith('dispute-1', 150);
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it('disables Confirm Resolution when amount is empty', () => {
    render(
      React.createElement(ResolveDisputeModal, {
        dispute: mockDispute,
        onResolved: vi.fn(),
        onClose: vi.fn(),
      })
    );
    expect(screen.getByRole('button', { name: /confirm resolution/i })).toBeDisabled();
  });
});
