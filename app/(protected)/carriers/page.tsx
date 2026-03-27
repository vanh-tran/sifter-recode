'use client';

import Header from '@/app/components/Header';

export default function CarriersPage() {
  return (
    <>
      <Header
        title="Carriers"
        subtitle="Carriers are auto-detected from your invoice emails. Manage billing contacts and rate sheets here."
      />
      <div className="page-transition mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-dashed border-brand-border bg-brand-surface p-12 text-center shadow-sm">
          <p className="text-sm text-brand-muted">
            Carrier cards with billing email and rate sheet uploads will appear here once wired to
            your data layer.
          </p>
        </div>
      </div>
    </>
  );
}
