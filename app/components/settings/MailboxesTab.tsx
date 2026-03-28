'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, AlertCircle, CheckCircle, MinusCircle, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Mailbox {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  status: 'active' | 'disconnected' | 'error';
  last_sync_at: string | null;
  last_error: string | null;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was cancelled. Please try again.',
  oauth_error: 'Something went wrong with the provider. Please try again.',
  invalid_session: 'OAuth session expired. Please try connecting again.',
  token_exchange_failed: "Couldn't complete the connection. Please try again.",
  userinfo_failed: "Couldn't fetch your email address. Please try again.",
  connection_failed: "Couldn't save the connection. Please try again.",
};

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
  const [pendingDisconnect, setPendingDisconnect] = useState<Mailbox | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setOauthError(OAUTH_ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.');
      const params = new URLSearchParams(searchParams.toString());
      params.delete('error');
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ''}`);
    }
  }, [searchParams, router, pathname]);

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
    onSuccess: () => {
      setPendingDisconnect(null);
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });

  const mailboxes = data?.mailboxes ?? [];

  return (
    <div className="space-y-6">
      {oauthError && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{oauthError}</span>
          <button
            onClick={() => setOauthError(null)}
            className="shrink-0 text-red-400 hover:text-red-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
                {canManage && mb.status === 'active' && (
                  <button
                    onClick={() => setPendingDisconnect(mb)}
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
            href="/api/oauth/gmail/connect?return_to=settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Gmail
          </a>
          <a
            href="/api/oauth/outlook/connect?return_to=settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Outlook
          </a>
        </div>
      )}

      {pendingDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-brand-surface border border-brand-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-brand-primary">Disconnect mailbox?</h3>
            <p className="text-sm text-brand-muted">
              <span className="font-medium text-brand-primary">{pendingDisconnect.email}</span> will
              be disconnected. Sifter will stop syncing emails from this account and all stored
              tokens will be revoked.
            </p>
            {disconnect.isError && (
              <p className="text-xs text-red-500">Something went wrong. Please try again.</p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setPendingDisconnect(null)}
                disabled={disconnect.isPending}
                className="px-3 py-1.5 text-sm text-brand-muted hover:text-brand-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => disconnect.mutate(pendingDisconnect.id)}
                disabled={disconnect.isPending}
                className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50"
              >
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
