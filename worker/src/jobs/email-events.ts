import type { Job } from 'bullmq';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import type { EmailEventsPayload } from '@sifter/core/queue/types';

export type DisputeMatchRow = {
  id: string;
  email_thread_id: string | null;
  status: string;
  invoice_id: string | null;
};

export function matchInboundEmailToDispute(
  disputes: DisputeMatchRow[],
  threadId: string
): DisputeMatchRow | null {
  return disputes.find((d) => d.email_thread_id === threadId && d.status !== 'resolved') ?? null;
}

export async function handleEmailEvents(job: Job<EmailEventsPayload>): Promise<void> {
  const { orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt } =
    job.data;

  const supabase = createServiceRoleClient();

  const { data: disputes } = await supabase
    .from('disputes')
    .select('id, email_thread_id, status, invoice_id')
    .eq('org_id', orgId)
    .not('email_thread_id', 'is', null)
    .neq('status', 'resolved');

  const matched = matchInboundEmailToDispute(disputes ?? [], threadId);
  if (!matched) return;

  await supabase.from('dispute_messages').insert({
    org_id: orgId,
    dispute_id: matched.id,
    direction: 'inbound',
    from_email: fromEmail,
    to_emails: toEmails,
    cc_emails: ccEmails ?? [],
    subject,
    body,
    email_message_id: messageId,
    email_thread_id: threadId,
    sent_at: receivedAt,
  });

  await supabase
    .from('disputes')
    .update({ status: 'carrier_replied', updated_at: new Date().toISOString() })
    .eq('id', matched.id)
    .eq('org_id', orgId);

  const { data: members } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active');

  const title = 'Carrier replied';
  const notificationBody = 'Carrier replied to your dispute';
  const createdAt = new Date().toISOString();

  for (const row of members ?? []) {
    const userId = row.user_id as string;
    await supabase.from('notifications').insert({
      org_id: orgId,
      user_id: userId,
      type: 'carrier_replied',
      title,
      body: notificationBody,
      invoice_id: matched.invoice_id,
      read: false,
      created_at: createdAt,
    });
  }
}
