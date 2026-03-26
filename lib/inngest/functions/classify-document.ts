import OpenAI from 'openai';
import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { getMongoDb } from '@/lib/mongodb/client';
import {
  classifyFreightInvoiceFromText,
  evaluateClassificationGate,
} from '@/lib/llm/classify-invoice';

export const classifyDocument = inngest.createFunction(
  { id: 'classify-document', name: 'Classify Document', triggers: [{ event: 'sifter/document.ocr.complete' }] },
  async ({ event, step }) => {
    const { orgId, documentId, mongodbDocumentId } = event.data;
    const supabase = createServiceRoleClient();

    const ocrText = await step.run('load-ocr', async () => {
      const db = await getMongoDb();
      const doc = await db.collection('document_ocr').findOne({ _id: mongodbDocumentId });
      return (doc?.rawText as string) ?? '';
    });

    const classification = await step.run('llm-classify', async () => {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return classifyFreightInvoiceFromText(ocrText, async (p) => {
        const res = await openai.chat.completions.create({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: p }],
        });
        return res.choices[0]?.message?.content ?? '{}';
      });
    });

    const gate = evaluateClassificationGate(classification);

    if (!gate.pass) {
      await step.run('mark-failed', async () => {
        await supabase
          .from('documents')
          .update({
            document_type: 'OTHER',
            processing_status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', documentId)
          .eq('org_id', orgId);
      });
      return { status: 'aborted', reason: gate.reason };
    }

    await step.run('mark-classified', async () => {
      await supabase
        .from('documents')
        .update({
          document_type: 'FREIGHT_INVOICE',
          processing_status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId)
        .eq('org_id', orgId);
    });

    await step.sendEvent('emit-classified', {
      name: 'sifter/document.classified',
      data: { orgId, documentId, mongodbDocumentId },
    });

    return { status: 'ok' };
  }
);
