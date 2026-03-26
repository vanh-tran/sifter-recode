// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InvoiceRightPanel from '@/app/components/invoices/InvoiceRightPanel';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('InvoiceRightPanel', () => {
  it('calls onOpenDispute when Open Dispute clicked', () => {
    const onOpenDispute = vi.fn();
    render(
      <InvoiceRightPanel
        invoiceId="inv1"
        dispute={null}
        selectedFindingIds={['f1']}
        disputeTotal={50}
        onOpenDispute={onOpenDispute}
        onApprove={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /open dispute/i }));
    expect(onOpenDispute).toHaveBeenCalled();
  });
});
