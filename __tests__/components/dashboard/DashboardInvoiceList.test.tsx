// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardInvoiceList from '@/app/components/dashboard/DashboardInvoiceList';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const invoice = {
  id: 'i1',
  invoice_number: 'INV-1',
  carrier_name: 'Acme',
  invoice_date: '2026-01-01',
  total_amount: 100,
  currency: 'USD',
  status: 'action_needed',
  findings_count: 1,
  finding_tags: ['rate_mismatch'],
  overcharge_amount: 12.5,
  filename: 'a.pdf',
  created_at: '2026-01-01T00:00:00Z',
};

describe('DashboardInvoiceList', () => {
  it('renders action button Review for action_needed', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <DashboardInvoiceList
          invoices={[invoice]}
          tab="action_needed"
          onTagClick={vi.fn()}
        />
      </QueryClientProvider>
    );
    expect(screen.getByRole('link', { name: /review/i })).toBeInTheDocument();
  });
});
