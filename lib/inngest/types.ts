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

  'sifter/invoice.audited': {
    data: {
      orgId: string;
      invoiceId: string;
      findingCount: number;
    };
  };

  'sifter/pipeline.health': { data: Record<string, never> };
};
