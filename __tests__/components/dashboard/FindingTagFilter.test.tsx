// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FindingTagFilter from '@/app/components/dashboard/FindingTagFilter';

afterEach(() => { cleanup(); });

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tag=rate_mismatch'),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
}));

describe('FindingTagFilter', () => {
  it('renders the tag label and clear button', () => {
    render(<FindingTagFilter />);
    expect(screen.getByText('Rate Mismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear tag filter/i })).toBeInTheDocument();
  });

  it('clears the tag on button click', () => {
    render(<FindingTagFilter />);
    fireEvent.click(screen.getByRole('button', { name: /clear tag filter/i }));
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });
});
