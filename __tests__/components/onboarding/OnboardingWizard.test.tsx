// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardingWizard from '@/app/(protected)/onboarding/OnboardingWizard';

afterEach(() => { cleanup(); });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ mailboxes: [] }),
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe('OnboardingWizard', () => {
  it('renders step 1 welcome message', () => {
    render(wrap(<OnboardingWizard orgName="Acme Logistics" />));
    expect(screen.getByText(/Welcome to Sifter/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Logistics/i)).toBeInTheDocument();
  });

  it('advances from step 1 to step 2 on Get Started click', () => {
    render(wrap(<OnboardingWizard orgName="Acme Logistics" />));
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByText(/Connect your mailbox/i)).toBeInTheDocument();
  });
});
