// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatsBar from '@/app/components/dashboard/StatsBar';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('StatsBar', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action_needed: 1,
              reviewing: 2,
              cleared: 3,
              overcharges_found_30d: 400,
              recovered_30d: 100,
            }),
        })
      ) as unknown as typeof fetch
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders five stat labels', async () => {
    render(
      <StatsBar
        stats={{
          action_needed: 1,
          reviewing: 2,
          cleared: 3,
          overcharges_found_30d: 400,
          recovered_30d: 100,
        }}
      />
    );
    expect(screen.getByText('Action Needed')).toBeInTheDocument();
    expect(screen.getByText('Reviewing')).toBeInTheDocument();
    expect(screen.getByText('Cleared')).toBeInTheDocument();
    expect(screen.getByText('Overcharges Found (30d)')).toBeInTheDocument();
    expect(screen.getByText('Recovered (30d)')).toBeInTheDocument();
  });
});
