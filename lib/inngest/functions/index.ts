import { inngest } from '@/lib/inngest/client';
import { ingestDocument } from './ingest-document';
import { classifyDocument } from './classify-document';
import { normalizeInvoice } from './normalize-invoice';
import { gatherContext } from './gather-context';
import { postAudit } from './post-audit';

const placeholder = inngest.createFunction(
  { id: 'pipeline-placeholder', name: 'Pipeline Placeholder', triggers: [{ event: 'sifter/pipeline.health' }] },
  async () => ({ ok: true })
);

export const inngestFunctions = [placeholder, ingestDocument, classifyDocument, normalizeInvoice, gatherContext, postAudit];
