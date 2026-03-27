'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { TeamTab } from '@/app/components/settings/TeamTab';
import { MailboxesTab } from '@/app/components/settings/MailboxesTab';
import { OrganizationTab } from '@/app/components/settings/OrganizationTab';

type Tab = 'team' | 'mailboxes' | 'organization';

interface Props {
  orgId: string;
  orgName: string;
  orgTimezone: string;
  currentUserId: string;
  role: string;
}

export default function SettingsClient({ orgName, orgTimezone, currentUserId, role }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('team');
  const canManageTeam = ['owner', 'admin'].includes(role);
  const canManageMailboxes = ['owner', 'admin'].includes(role);
  const isOwner = role === 'owner';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'team', label: 'Team' },
    { id: 'mailboxes', label: 'Mailboxes' },
    { id: 'organization', label: 'Organization' },
  ];

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold text-brand-primary mb-6">Settings</h1>

      <div className="border-b border-brand-border mb-6">
        <nav className="flex -mb-px space-x-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-brand-muted hover:text-brand-primary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'team' && (
        <TeamTab canManage={canManageTeam} currentUserId={currentUserId} />
      )}
      {activeTab === 'mailboxes' && (
        <MailboxesTab canManage={canManageMailboxes} />
      )}
      {activeTab === 'organization' && (
        <OrganizationTab
          initialName={orgName}
          initialTimezone={orgTimezone}
          isOwner={isOwner}
        />
      )}
    </main>
  );
}
