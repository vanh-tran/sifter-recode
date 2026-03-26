// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FindingsList from '@/app/components/invoices/FindingsList';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const finding = {
  id: 'f1',
  finding_type: 'rate_mismatch',
  source: 'ai_audit' as const,
  severity: 'high' as const,
  summary: 'Rate mismatch on fuel surcharge',
  description_edited: null,
  delta_amount: 50,
  amount_edited: null,
  confidence: 0.9,
  proof_clip_urls: [],
};

describe('FindingsList', () => {
  it('calls onToggle when checkbox clicked', () => {
    const onToggle = vi.fn();
    render(
      <FindingsList
        findings={[finding]}
        selectedIds={[]}
        onToggle={onToggle}
      />
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('f1', true);
  });
});
