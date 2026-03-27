export type SifterEvents = {
  'sifter/document.received': {
    data: {
      orgId: string;
      documentId: string;
      gcsKey: string;
      sourceType: 'email' | 'upload' | 'api';
    };
  };

  'sifter/document.classified': {
    data: {
      orgId: string;
      documentId: string;
      mongodbDocumentId: string;
    };
  };

  'sifter/invoice.normalized': {
    data: {
      orgId: string;
      invoiceId: string;
    };
  };

  'sifter/invoice.context_ready': {
    data: {
      orgId: string;
      invoiceId: string;
      bolDocumentIds: string[];
      rateSheetId: string | null;
    };
  };

  'sifter/invoice.audited': {
    data: {
      orgId: string;
      invoiceId: string;
      findingCount: number;
    };
  };

  'sifter/document.ocr.complete': {
    data: {
      orgId: string;
      documentId: string;
      mongodbDocumentId: string;
    };
  };

  'sifter/pipeline.health': { data: Record<string, never> };

  'email.received': {
    data: {
      org_id: string;
      thread_id: string;
      message_id: string;
      from_email: string;
      to_emails: string[];
      cc_emails?: string[];
      subject: string;
      body: string;
      received_at: string;
    };
  };

  'email.unmatched': {
    data: {
      org_id: string;
      thread_id: string;
      message_id: string;
      from_email: string;
      to_emails: string[];
      cc_emails?: string[];
      subject: string;
      body: string;
      received_at: string;
    };
  };

  'notification.created': {
    data: {
      org_id: string;
      type: string;
      dispute_id: string;
      message: string;
    };
  };
};
