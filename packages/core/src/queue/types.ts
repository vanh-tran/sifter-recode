export interface Phase1Payload {
  orgId: string;
  documentId: string;
  gcsKey: string;
  sourceType: 'upload' | 'email';
  sourceMessageId?: string;
  sourceThreadId?: string;
}

export interface Phase2Payload {
  orgId: string;
  documentId: string;
  isReaudit: boolean;
}

/** No fields — worker syncs all active Gmail connections. */
export type GmailSyncPayload = Record<string, never>;

export interface EmailEventsPayload {
  orgId: string;
  threadId: string;
  messageId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  receivedAt: string;
}
