import { createHash } from 'crypto';
import { getStorage } from '../gcs.js';
import type { gmail_v1 } from 'googleapis';
import { createServiceRoleClient } from '@sifter/core/supabase/service-role';
import { buildGmailClient, nextHistoryId } from '@sifter/core/email/gmail-poller';
import { decryptOAuthSecret } from '@sifter/core/server/oauth-token-crypto';
import { phase1Queue, emailEventsQueue } from '@sifter/core/queue/index';
import type { Phase1Payload } from '@sifter/core/queue/types';

const EMAIL_BACKLOG_DAYS = Number(process.env.EMAIL_BACKLOG_DAYS ?? 60);

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return '';
}

function findPdfAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  const results: gmail_v1.Schema$MessagePart[] = [];
  if (payload.filename?.toLowerCase().endsWith('.pdf') && payload.body?.attachmentId) {
    results.push(payload);
  }
  for (const part of payload.parts ?? []) {
    results.push(...findPdfAttachments(part));
  }
  return results;
}

async function processMessage(
  gmail: Awaited<ReturnType<typeof buildGmailClient>>,
  orgId: string,
  messageId: string,
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<void> {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const headers = msg.data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find(
      (h: { name?: string | null; value?: string | null }) =>
        h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? '';

  const threadId = msg.data.threadId ?? messageId;
  const fromEmail = getHeader('from');
  const toEmails = getHeader('to').split(',').map((s: string) => s.trim()).filter(Boolean);
  const ccEmails = getHeader('cc').split(',').map((s: string) => s.trim()).filter(Boolean);
  const subject = getHeader('subject');
  const dateStr = getHeader('date');
  const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
  const body = extractBody(msg.data.payload);

  await emailEventsQueue.add(
    `email-${messageId}`,
    { orgId, threadId, messageId, fromEmail, toEmails, ccEmails, subject, body, receivedAt },
    { jobId: `email-${messageId}` }
  );

  const attachments = findPdfAttachments(msg.data.payload);
  if (attachments.length === 0) return;

  // Write fan-in batch BEFORE processing any attachments
  await supabase.from('email_message_batches').upsert({
    org_id: orgId,
    source_message_id: messageId,
    source_thread_id: threadId,
    sibling_count: attachments.length,
  }, { onConflict: 'org_id,source_message_id', ignoreDuplicates: true });

  const storage = getStorage();
  const bucket = storage.bucket(process.env.GCS_BUCKET!);

  for (const att of attachments) {
    if (!att.body?.attachmentId) continue;

    const attData = await gmail.users.messages.attachments.get({
      userId: 'me', messageId, id: att.body.attachmentId,
    });

    const buf = Buffer.from(attData.data.data ?? '', 'base64url');
    const sha256 = createHash('sha256').update(buf).digest('hex');

    const { data: existing } = await supabase
      .from('documents').select('id').eq('org_id', orgId).eq('sha256', sha256).maybeSingle();
    if (existing) {
      // Duplicate attachment — still counts toward sibling_count; increment fan-in manually
      await supabase.rpc('increment_batch_phase1', {
        p_org_id: orgId,
        p_source_message_id: messageId,
        p_freight_invoice_doc_id: null,
      });
      continue;
    }

    const filename = att.filename || `attachment-${att.body.attachmentId}.pdf`;
    const gcsKey = `orgs/${orgId}/emails/${messageId}/${filename}`;
    await bucket.file(gcsKey).save(buf, { contentType: 'application/pdf' });

    const { data: doc, error: docInsertError } = await supabase
      .from('documents')
      .insert({
        org_id: orgId,
        source_type: 'email',
        source_message_id: messageId,
        source_thread_id: threadId,
        filename,
        mime_type: 'application/pdf',
        file_size_bytes: buf.length,
        gcs_key: gcsKey,
        sha256,
        processing_status: 'pending',
      })
      .select('id')
      .single();

    if (docInsertError) {
      throw new Error(`gmail-sync: failed to insert document for attachment ${filename}: ${docInsertError.message}`);
    }
    if (!doc) continue;

    await phase1Queue.add(
      `phase1-${doc.id}`,
      {
        orgId,
        documentId: doc.id,
        gcsKey,
        sourceType: 'email',
        sourceMessageId: messageId,
        sourceThreadId: threadId,
      } satisfies Phase1Payload,
      { jobId: `phase1-${doc.id}` }
    );
  }
}

export async function handleGmailSync(): Promise<{ processed: number }> {
  const supabase = createServiceRoleClient();

  const { data: connections, error } = await supabase
    .from('email_connections')
    .select('id, org_id, last_history_id, oauth_tokens ( refresh_token_encrypted )')
    .eq('provider', 'gmail')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to fetch email connections: ${error.message}`);

  for (const connection of connections ?? []) {
    const { id: connectionId, org_id: orgId, last_history_id: lastHistoryId } = connection;
    const tokenRows = connection.oauth_tokens as unknown as { refresh_token_encrypted: string }[] | { refresh_token_encrypted: string } | null;
    const encryptedToken = Array.isArray(tokenRows)
      ? tokenRows[0]?.refresh_token_encrypted
      : (tokenRows as { refresh_token_encrypted: string } | null)?.refresh_token_encrypted ?? null;
    if (!encryptedToken) continue;

    try {
      const refreshToken = await decryptOAuthSecret(encryptedToken);
      const gmail = await buildGmailClient(refreshToken);
      let newHistoryId: string | null = null;

      if (!lastHistoryId) {
        const afterDate = new Date();
        afterDate.setDate(afterDate.getDate() - EMAIL_BACKLOG_DAYS);
        const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

        console.log('[gmail-sync] listing messages...');
        const listResp = await gmail.users.messages.list({
          userId: 'me',
          q: `after:${afterTimestamp} has:attachment filename:pdf`,
          maxResults: 500,
        });
        console.log('[gmail-sync] found', listResp.data.messages?.length ?? 0, 'messages');

        for (const msg of listResp.data.messages ?? []) {
          if (msg.id) await processMessage(gmail, orgId as string, msg.id, supabase);
        }

        console.log('[gmail-sync] getting profile...');
        const profile = await gmail.users.getProfile({ userId: 'me' });
        newHistoryId = profile.data.historyId ?? null;
      } else {
        const histResp = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: lastHistoryId as string,
          historyTypes: ['messageAdded'],
          labelId: 'INBOX',
        });

        newHistoryId = nextHistoryId({
          history: (histResp.data.history ?? []) as { id?: string }[],
        });

        for (const record of histResp.data.history ?? []) {
          for (const added of record.messagesAdded ?? []) {
            if (added.message?.id) {
              await processMessage(gmail, orgId as string, added.message.id, supabase);
            }
          }
        }
      }

      await supabase
        .from('email_connections')
        .update({
          ...(newHistoryId ? { last_history_id: newHistoryId } : {}),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[gmail-sync] connection failed', connectionId, message);
      await supabase
        .from('email_connections')
        .update({
          last_error: message.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId);
    }
  }

  return { processed: (connections ?? []).length };
}
