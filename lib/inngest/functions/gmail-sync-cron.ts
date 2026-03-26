import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { buildGmailClient, nextHistoryId } from '@/lib/email/gmail-poller';

const EMAIL_BACKLOG_DAYS = Number(process.env.EMAIL_BACKLOG_DAYS ?? 60);

async function processMessage(
  _gmail: Awaited<ReturnType<typeof buildGmailClient>>,
  _orgId: string,
  _messageId: string
): Promise<void> {
  throw new Error('TODO: implement processMessage');
}

export const gmailSyncCron = inngest.createFunction(
  { id: 'gmail-sync-cron', name: 'Gmail Sync Cron' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const supabase = createServiceRoleClient();

    const connections = await step.run('fetch-email-connections', async () => {
      const { data, error } = await supabase
        .from('email_connections')
        .select('id, org_id, refresh_token, last_history_id')
        .eq('provider', 'gmail')
        .eq('active', true);

      if (error) throw new Error(`Failed to fetch email connections: ${error.message}`);
      return data ?? [];
    });

    for (const connection of connections) {
      const { id: connectionId, org_id: orgId, refresh_token: refreshToken, last_history_id: lastHistoryId } = connection;

      await step.run(`sync-connection-${connectionId}`, async () => {
        const gmail = await buildGmailClient(refreshToken as string);
        let newHistoryId: string | null = null;

        if (!lastHistoryId) {
          // Backfill: list messages from last EMAIL_BACKLOG_DAYS days with PDF attachments
          const afterDate = new Date();
          afterDate.setDate(afterDate.getDate() - EMAIL_BACKLOG_DAYS);
          const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

          const listResp = await gmail.users.messages.list({
            userId: 'me',
            q: `after:${afterTimestamp} has:attachment filename:pdf`,
            maxResults: 500,
          });

          const messages = listResp.data.messages ?? [];
          for (const msg of messages) {
            if (msg.id) {
              try {
                await processMessage(gmail, orgId as string, msg.id);
              } catch {
                // processMessage is a stub — expected to throw
              }
            }
          }

          // Get latest history ID from profile
          const profile = await gmail.users.getProfile({ userId: 'me' });
          newHistoryId = profile.data.historyId ?? null;
        } else {
          // Incremental sync via history.list
          const histResp = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: lastHistoryId as string,
            historyTypes: ['messageAdded'],
            labelId: 'INBOX',
          });

          newHistoryId = nextHistoryId({ history: (histResp.data.history ?? []) as { id?: string }[] });

          const messages: string[] = [];
          for (const record of histResp.data.history ?? []) {
            for (const added of record.messagesAdded ?? []) {
              if (added.message?.id) {
                messages.push(added.message.id);
              }
            }
          }

          for (const msgId of messages) {
            try {
              await processMessage(gmail, orgId as string, msgId);
            } catch {
              // processMessage is a stub — expected to throw
            }
          }
        }

        if (newHistoryId) {
          await supabase
            .from('email_connections')
            .update({ last_history_id: newHistoryId, updated_at: new Date().toISOString() })
            .eq('id', connectionId);
        }
      });
    }

    return { processed: connections.length };
  }
);
