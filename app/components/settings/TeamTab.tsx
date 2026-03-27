'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';

type Role = 'owner' | 'admin' | 'member' | 'viewer';
type MemberStatus = 'active' | 'invited';

interface Member {
  id: string;
  role: Role;
  status: MemberStatus;
  users: { id: string; email: string; full_name: string | null; avatar_url: string | null };
}

function roleBadgeClass(role: Role) {
  const map: Record<Role, string> = {
    owner: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    member: 'bg-gray-100 text-gray-700',
    viewer: 'bg-gray-100 text-gray-500',
  };
  return map[role];
}

function Initials({ name, email }: { name: string | null; email: string }) {
  const label = name ?? email;
  const initials = label.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center text-xs font-semibold text-brand-primary flex-shrink-0">
      {initials}
    </div>
  );
}

interface TeamTabProps {
  canManage: boolean;
  currentUserId: string;
}

export function TeamTab({ canManage, currentUserId }: TeamTabProps) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ members: Member[] }>({
    queryKey: ['team'],
    queryFn: async () => {
      const res = await fetch('/api/team');
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/team/${userId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove member');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await fetch(`/api/team/invites/${inviteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke invite');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to invite');
      return json;
    },
    onSuccess: () => {
      setInviteEmail('');
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err: Error) => setInviteError(err.message),
  });

  const active = data?.members.filter((m) => m.status === 'active') ?? [];
  const invited = data?.members.filter((m) => m.status === 'invited') ?? [];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
          Team Members
        </h3>
        {isLoading && <p className="text-sm text-brand-muted">Loading…</p>}
        <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
          {active.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
              <Initials name={m.users.full_name} email={m.users.email} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-primary truncate">
                  {m.users.full_name ?? m.users.email}
                </p>
                <p className="text-xs text-brand-muted truncate">{m.users.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${roleBadgeClass(m.role)}`}>
                {m.role}
              </span>
              {canManage && m.role !== 'owner' && m.users.id !== currentUserId && (
                <button
                  onClick={() => removeMember.mutate(m.users.id)}
                  disabled={removeMember.isPending}
                  className="text-brand-muted hover:text-red-500 transition-colors"
                  aria-label={`Remove ${m.users.email}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invited.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
            Pending Invites
          </h3>
          <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
            {invited.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
                <Initials name={m.users.full_name} email={m.users.email} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-brand-primary truncate">{m.users.email}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-700">
                  Invited
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${roleBadgeClass(m.role)}`}>
                  {m.role}
                </span>
                {canManage && (
                  <button
                    onClick={() => revokeInvite.mutate(m.id)}
                    disabled={revokeInvite.isPending}
                    className="text-xs text-brand-muted hover:text-red-500 transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <section>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
            Invite a Team Member
          </h3>
          <div className="flex gap-2 flex-wrap">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 min-w-48 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={() => sendInvite.mutate()}
              disabled={sendInvite.isPending || !inviteEmail}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {sendInvite.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-600 mt-2">{inviteError}</p>}
        </section>
      )}
    </div>
  );
}
