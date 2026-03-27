'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

const TIMEZONES = Intl.supportedValuesOf('timeZone');

interface OrganizationTabProps {
  initialName: string;
  initialTimezone: string;
  isOwner: boolean;
}

export function OrganizationTab({ initialName, initialTimezone, isOwner }: OrganizationTabProps) {
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone || 'UTC');
  const [saved, setSaved] = useState(false);

  const updateOrg = useMutation({
    mutationFn: async (updates: { name?: string; timezone?: string }) => {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update organization');
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-brand-primary mb-1.5">
          Organization Name
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
          />
          {isOwner && (
            <button
              onClick={() => updateOrg.mutate({ name })}
              disabled={updateOrg.isPending || name === initialName}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-brand-primary mb-1.5">
          Timezone
        </label>
        <div className="flex gap-2">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!isOwner}
            className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          {isOwner && (
            <button
              onClick={() => updateOrg.mutate({ timezone })}
              disabled={updateOrg.isPending || timezone === initialTimezone}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {saved && <p className="text-sm text-green-600">Changes saved.</p>}
      {updateOrg.isError && <p className="text-sm text-red-600">Failed to save changes.</p>}

      {!isOwner && (
        <p className="text-xs text-brand-muted italic">
          Only the organization owner can edit these settings.
        </p>
      )}
    </div>
  );
}
