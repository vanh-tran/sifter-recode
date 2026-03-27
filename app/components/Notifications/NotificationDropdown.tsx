'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Mail, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export interface Notification {
  id: string;
  type: 'carrier_replied' | 'invoice_ready' | 'dispute_resolved';
  title: string;
  body: string;
  invoice_id: string | null;
  read: boolean;
  created_at: string;
}

function NotificationIcon({ type }: { type: Notification['type'] }) {
  if (type === 'carrier_replied') return <Mail className="w-4 h-4 text-blue-500" />;
  if (type === 'invoice_ready') return <FileText className="w-4 h-4 text-green-500" />;
  return <CheckCircle2 className="w-4 h-4 text-purple-500" />;
}

interface Props {
  notifications: Notification[];
  onClose: () => void;
}

export function NotificationDropdown({ notifications, onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch('/api/notifications/read-all', { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleNotificationClick(n: Notification) {
    if (!n.read) markRead.mutate(n.id);
    if (n.invoice_id) router.push(`/invoices/${n.invoice_id}`);
    onClose();
  }

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="absolute right-0 mt-2 w-80 rounded-xl shadow-lg bg-brand-surface border border-brand-border z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
        <span className="text-sm font-semibold text-brand-primary">Notifications</span>
        {hasUnread && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="text-xs text-brand-muted hover:text-brand-primary transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Bell className="w-8 h-8 mx-auto text-brand-muted mb-2" />
          <p className="text-sm text-brand-muted">No notifications yet</p>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-brand-border">
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              className={cn(
                'flex gap-3 px-4 py-3 cursor-pointer hover:bg-brand-surface-muted transition-colors',
                !n.read && 'bg-blue-50/40'
              )}
            >
              <div className="flex-shrink-0 mt-0.5">
                <NotificationIcon type={n.type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', !n.read ? 'font-semibold text-brand-primary' : 'text-brand-primary')}>
                  {n.title}
                </p>
                <p className="text-xs text-brand-muted mt-0.5 truncate">{n.body}</p>
                <p className="text-xs text-brand-muted mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
              {!n.read && (
                <div className="flex-shrink-0 mt-1.5 w-2 h-2 rounded-full bg-blue-500" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
