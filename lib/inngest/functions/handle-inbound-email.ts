import { inngest } from '@/lib/inngest/client';
import { createClient } from '@/lib/supabase/server';

/** Pure matching logic — exported for unit testing */
export function matchInboundEmailToDispute(
  disputes: Array<{ id: string; email_thread_id: string | null; status: string }>,
  threadId: string
): { id: string; email_thread_id: string | null; status: string } | null {
  return (
    disputes.find(
      d => d.email_thread_id === threadId && d.status !== 'resolved'
    ) ?? null
  );
}

export const handleInboundEmail = inngest.createFunction(
  { id: 'handle-inbound-email', name: 'Handle Inbound Email', triggers: [{ event: 'email.received' }] },
  async ({ event, step }) => {
    const { org_id, thread_id, message_id, from_email, to_emails, cc_emails, subject, body, received_at } =
      event.data;

    const supabase = await createClient();

    const matchedDispute = await step.run('match-dispute', async () => {
      const { data: disputes } = await supabase
        .from('disputes')
        .select('id, email_thread_id, status')
        .eq('org_id', org_id)
        .not('email_thread_id', 'is', null)
        .neq('status', 'resolved');

      return matchInboundEmailToDispute(disputes ?? [], thread_id);
    });

    if (!matchedDispute) {
      await step.sendEvent('forward-to-ingestion', {
        name: 'email.unmatched',
        data: event.data,
      });
      return { matched: false };
    }

    await step.run('append-inbound-message', async () => {
      await supabase.from('dispute_messages').insert({
        org_id,
        dispute_id: matchedDispute.id,
        direction: 'inbound',
        from_email,
        to_emails,
        cc_emails: cc_emails ?? [],
        subject,
        body,
        email_message_id: message_id,
        email_thread_id: thread_id,
        sent_at: received_at,
      });
    });

    await step.run('update-dispute-status', async () => {
      await supabase
        .from('disputes')
        .update({ status: 'carrier_replied', updated_at: new Date().toISOString() })
        .eq('id', matchedDispute.id)
        .eq('org_id', org_id);
    });

    await step.sendEvent('emit-notification', {
      name: 'notification.created',
      data: {
        org_id,
        type: 'carrier_replied',
        dispute_id: matchedDispute.id,
        message: `Carrier replied to your dispute`,
      },
    });

    return { matched: true, dispute_id: matchedDispute.id };
  }
);
