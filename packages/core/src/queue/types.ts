export interface DocumentPipelinePayload {
  orgId: string;
  documentId: string;
  gcsKey: string;
  sourceType: 'upload' | 'email';
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
