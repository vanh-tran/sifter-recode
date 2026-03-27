'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, AlertCircle, CheckCircle, MinusCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Mailbox {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  status: 'active' | 'disconnected' | 'error';
  last_sync_at: string | null;
  last_error: string | null;
}

function StatusDot({ status }: { status: Mailbox['status'] }) {
  if (status === 'active') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <MinusCircle className="w-4 h-4 text-gray-400" />;
}

interface MailboxesTabProps {
  canManage: boolean;
}

export function MailboxesTab({ canManage }: MailboxesTabProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ mailboxes: Mailbox[] }>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      const res = await fetch('/api/mailboxes');
      if (!res.ok) throw new Error('Failed to fetch mailboxes');
      return res.json();
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/mailboxes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
  });

  const mailboxes = data?.mailboxes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
          Connected Accounts
        </h3>

        {isLoading && <p className="text-sm text-brand-muted">Loading…</p>}

        {!isLoading && mailboxes.length === 0 && (
          <p className="text-sm text-brand-muted italic">No mailboxes connected.</p>
        )}

        {mailboxes.length > 0 && (
          <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
            {mailboxes.map((mb) => (
              <li key={mb.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
                <Mail className="w-5 h-5 text-brand-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-primary truncate">{mb.email}</p>
                  <p className="text-xs text-brand-muted capitalize">
                    {mb.provider}
                    {mb.last_sync_at
                      ? ` · synced ${formatDistanceToNow(new Date(mb.last_sync_at), { addSuffix: true })}`
                      : ' · never synced'}
                  </p>
                  {mb.status === 'error' && mb.last_error && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">{mb.last_error}</p>
                  )}
                </div>
                <StatusDot status={mb.status} />
                {canManage && (
                  <button
                    onClick={() => disconnect.mutate(mb.id)}
                    disabled={disconnect.isPending}
                    className="text-xs text-brand-muted hover:text-red-500 transition-colors ml-2"
                  >
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="flex gap-3">
          <a
            href="/api/oauth/gmail/connect"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Gmail
          </a>
          <a
            href="/api/oauth/outlook/connect"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Outlook
          </a>
        </div>
      )}
    </div>
  );
}
