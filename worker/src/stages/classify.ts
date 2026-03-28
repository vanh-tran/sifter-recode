import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import {
  classifyFreightInvoiceFromText,
  evaluateClassificationGate,
} from '@sifter/core/llm/classify-invoice';

interface ClassifyStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

interface ClassifyResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Idempotent: skips LLM call if document_type is already set.
 * Returns { rejected: true } if document is not a freight invoice.
 */
export async function runClassifyStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: ClassifyStageInput
): Promise<ClassifyResult> {
  const { data: existing } = await supabase
    .from('documents')
    .select('document_type')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .single();

  if (existing?.document_type) {
    return { rejected: existing.document_type !== 'FREIGHT_INVOICE' };
  }

  const doc = await db.collection('document_ocr').findOne({ _id: mongoDocId as unknown as import('mongodb').ObjectId });
  const ocrText = (doc?.rawText as string) ?? '';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const classification = await classifyFreightInvoiceFromText(ocrText, async (p: string) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: p }],
    });
    return res.choices[0]?.message?.content ?? '{}';
  });

  const gate = evaluateClassificationGate(classification);

  if (!gate.pass) {
    await supabase
      .from('documents')
      .update({
        document_type: 'OTHER',
        processing_status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .eq('org_id', orgId);
    return { rejected: true, reason: gate.reason };
  }

  await supabase
    .from('documents')
    .update({
      document_type: 'FREIGHT_INVOICE',
      processing_status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('org_id', orgId);

  return { rejected: false };
}
