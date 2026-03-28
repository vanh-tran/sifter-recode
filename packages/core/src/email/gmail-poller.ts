import { google } from 'googleapis';

export function nextHistoryId(resp: { history?: { id?: string }[] }): string | null {
  if (!resp.history?.length) return null;
  return resp.history.reduce((max, h) => {
    const id = h.id ?? '';
    return id > max ? id : max;
  }, '');
}

export async function buildGmailClient(refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}
