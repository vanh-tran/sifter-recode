import { google } from 'googleapis';
import { createServiceRoleClient } from '../supabase/service-role.js';
import { decryptOAuthSecret } from '../server/oauth-token-crypto.js';

export interface SendDisputeEmailInput {
  orgId: string;
  userId: string;
  toEmail: string;
  toName?: string;
  subject: string;
  body: string;
  inReplyToThreadId?: string;
}

export interface SendDisputeEmailResult {
  threadId: string;
  messageId: string;
  provider: 'gmail' | 'outlook';
}

async function sendViaGmail(
  accessToken: string,
  input: SendDisputeEmailInput,
  inReplyToThreadId?: string
): Promise<SendDisputeEmailResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const toHeader = input.toName ? `"${input.toName}" <${input.toEmail}>` : input.toEmail;
  const rawLines = [
    `To: ${toHeader}`,
    `Subject: ${input.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    input.body,
  ];
  const rawMessage = rawLines.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      ...(inReplyToThreadId ? { threadId: inReplyToThreadId } : {}),
    },
  });

  return {
    threadId: result.data.threadId ?? '',
    messageId: result.data.id ?? '',
    provider: 'gmail',
  };
}

async function sendViaOutlook(
  accessToken: string,
  input: SendDisputeEmailInput
): Promise<SendDisputeEmailResult> {
  const createRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: 'Text', content: input.body },
      toRecipients: [{ emailAddress: { address: input.toEmail, name: input.toName } }],
    }),
  });
  if (!createRes.ok) throw new Error(`Outlook create message failed: ${await createRes.text()}`);
  const created = (await createRes.json()) as { id: string; conversationId?: string };

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${created.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sendRes.ok) throw new Error(`Outlook send failed: ${await sendRes.text()}`);

  const getRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${created.id}?$select=id,conversationId`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const sent = (await getRes.json()) as { id: string; conversationId?: string };
  return {
    threadId: sent.conversationId ?? created.conversationId ?? '',
    messageId: sent.id,
    provider: 'outlook',
  };
}

export async function sendDisputeEmail(input: SendDisputeEmailInput): Promise<SendDisputeEmailResult> {
  const supabase = createServiceRoleClient();

  const { data: connection, error: connError } = await supabase
    .from('email_connections')
    .select('id, provider')
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (connError || !connection) {
    throw new Error('No active email connection found. Please reconnect your mailbox.');
  }

  const { data: token, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('access_token_encrypted, refresh_token_encrypted, expires_at')
    .eq('connection_id', connection.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (tokenError || !token || !token.access_token_encrypted) {
    throw new Error('OAuth token not found or expired. Please reconnect your mailbox.');
  }

  const accessToken = await decryptOAuthSecret(token.access_token_encrypted);

  if (connection.provider === 'gmail') {
    return sendViaGmail(accessToken, input, input.inReplyToThreadId);
  } else if (connection.provider === 'outlook') {
    return sendViaOutlook(accessToken, input);
  } else {
    throw new Error(`Unsupported email provider: ${connection.provider}`);
  }
}
