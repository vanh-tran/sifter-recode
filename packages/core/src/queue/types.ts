export interface DocumentPipelinePayload {
  orgId: string;
  documentId: string;
  gcsKey: string;
  sourceType: 'upload' | 'email';
}

export interface GmailSyncPayload {
  orgId: string;
  mailboxId: string;
}

export interface EmailEventsPayload {
  orgId: string;
  mailboxId: string;
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
}
