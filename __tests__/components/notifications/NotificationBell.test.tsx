// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBell } from '@/app/components/Notifications/NotificationBell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ notifications: [], unread_count: 3 }),
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('NotificationBell', () => {
  it('renders bell button', () => {
    render(wrap(<NotificationBell />));
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('shows unread badge when count > 0', async () => {
    render(wrap(<NotificationBell />));
    const badge = await screen.findByText('3');
    expect(badge).toBeInTheDocument();
  });
});
