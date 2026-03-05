'use client';

import { useAuth } from '@/app/components/AuthProvider';
import { useOrg } from '@/app/components/OrgProvider';
import Header from '@/app/components/Header';

export default function DashboardPage() {
  const { user } = useAuth();
  const orgId = useOrg();

  return (
    <>
      <Header
        title="Dashboard"
        subtitle={`Welcome back, ${user?.user_metadata?.full_name || user?.email}`}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-lg border border-brand-border bg-brand-surface p-6">
          <h3 className="text-sm font-medium text-brand-muted">Organization</h3>
          <p className="mt-1 font-mono text-xs text-brand-muted-light">{orgId}</p>
        </div>
      </main>
    </>
  );
}
