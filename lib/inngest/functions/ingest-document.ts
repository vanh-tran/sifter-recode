import { Storage } from '@google-cloud/storage';
import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { extractTextFromPdfBuffer } from '@/lib/ocr/extract-text';
import { getMongoDb } from '@/lib/mongodb/client';
import { randomUUID } from 'crypto';

export const ingestDocument = inngest.createFunction(
  { id: 'ingest-document', name: 'Ingest Document (OCR)', triggers: [{ event: 'sifter/document.received' }] },
  async ({ event, step }) => {
    const { orgId, documentId, gcsKey } = event.data;
    const supabase = createServiceRoleClient();

    const text = await step.run('download-and-ocr', async () => {
      const storage = new Storage();
      const [buf] = await storage.bucket(process.env.GCS_BUCKET!).file(gcsKey).download();
      return extractTextFromPdfBuffer(buf as Buffer);
    });

    const mongoId = await step.run('persist-ocr-text', async () => {
      const db = await getMongoDb();
      const id = randomUUID();
      await db.collection('document_ocr').insertOne({
        _id: id as unknown,
        orgId,
        documentId,
        rawText: text,
        createdAt: new Date(),
      });
      return id;
    });

    await step.run('link-document-mongo', async () => {
      await supabase
        .from('documents')
        .update({
          mongodb_document_id: mongoId,
          processing_status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('org_id', orgId);
    });

    await step.sendEvent('emit-ocr-complete', {
      name: 'sifter/document.ocr.complete',
      data: { orgId, documentId, mongodbDocumentId: mongoId },
    });

    return { mongoId };
  }
);
