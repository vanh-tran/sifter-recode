// worker/src/stages/classify.ts
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import {
  classifyDocument,
  evaluateClassificationGate,
  type DocumentType,
  type ExtractedRefs,
} from '@sifter/core/llm/classify-invoice';

interface ClassifyStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

export interface ClassifyStageResult {
  documentType: DocumentType;
  extractedRefs: ExtractedRefs;
  rejected: boolean;
  reason?: string;
}

const EMPTY_REFS: ExtractedRefs = {
  invoiceNumbers: [], bolNumbers: [], proNumbers: [],
  poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null,
};

/**
 * Idempotent: skips LLM call if classification_method is already set.
 */
export async function runClassifyStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: ClassifyStageInput
): Promise<ClassifyStageResult> {
  const { data: existing } = await supabase
    .from('documents')
    .select('document_type, classification_method, extracted_refs')
    .eq('id', documentId)
    .eq('org_id', orgId)
    .single();

  if (existing?.classification_method) {
    return {
      documentType: existing.document_type as DocumentType,
      extractedRefs: (existing.extracted_refs as ExtractedRefs) ?? EMPTY_REFS,
      rejected: existing.document_type !== 'FREIGHT_INVOICE',
    };
  }

  const doc = await db.collection('document_ocr').findOne({
    _id: mongoDocId as unknown as import('mongodb').ObjectId,
  });
  const ocrText = (doc?.rawText as string) ?? '';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const classification = await classifyDocument(ocrText, async (p: string) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: p }],
    });
    return res.choices[0]?.message?.content ?? '{}';
  });

  const gate = evaluateClassificationGate(classification);

  await supabase
    .from('documents')
    .update({
      document_type: classification.documentType,
      classification_confidence: classification.confidence,
      classification_method: 'ai',
      extracted_refs: classification.extractedRefs,
      processing_status: gate.pass ? 'processing' : 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('org_id', orgId);

  return {
    documentType: classification.documentType,
    extractedRefs: classification.extractedRefs,
    rejected: !gate.pass,
    reason: gate.reason,
  };
}
