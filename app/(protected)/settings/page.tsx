'use client';

import { useState } from 'react';
import Header from '@/app/components/Header';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'team' as const, label: 'Team' },
  { id: 'mailboxes' as const, label: 'Mailboxes' },
  { id: 'organization' as const, label: 'Organization' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('team');

  return (
    <>
      <Header
        title="Settings"
        subtitle="Manage your team, connected mailboxes, and organization details."
      />
      <div className="page-transition mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div
          className="mb-8 flex flex-wrap gap-2 border-b border-brand-border pb-px"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-[#4f8ef7] text-brand-primary'
                  : 'border-transparent text-brand-muted hover:text-brand-primary'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          className="rounded-lg border border-brand-border bg-brand-surface p-8 shadow-sm"
          role="tabpanel"
        >
          {tab === 'team' && (
            <div className="text-center text-brand-muted">
              <p className="text-sm">Team invites and roles will appear here.</p>
              <p className="mt-2 text-xs">Connect this UI to your org API when ready.</p>
            </div>
          )}
          {tab === 'mailboxes' && (
            <div className="text-center text-brand-muted">
              <p className="text-sm">Connected Gmail / Outlook accounts will appear here.</p>
              <p className="mt-2 text-xs">Mailbox management is coming in a later milestone.</p>
            </div>
          )}
          {tab === 'organization' && (
            <div className="text-center text-brand-muted">
              <p className="text-sm">Organization name and timezone will be editable here.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
