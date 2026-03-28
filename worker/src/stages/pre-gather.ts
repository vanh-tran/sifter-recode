import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';

export interface PreGatheredContext {
  invoiceRawText: string;
  rateSheetText: string | null;
  bolTexts: string[];
}

const RATE_SHEET_MAX = 40_000;
const BOL_MAX = 20_000;

async function fetchMongoText(db: Db, mongoDocId: string | null | undefined): Promise<string> {
  if (!mongoDocId) return '';
  const doc = await db.collection('document_ocr').findOne({
    _id: mongoDocId as unknown as import('mongodb').ObjectId,
  });
  return (doc?.rawText as string) ?? '';
}

export async function runPreGatherStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, invoiceId, invoiceDocumentId }: { orgId: string; invoiceId: string; invoiceDocumentId: string }
): Promise<PreGatheredContext> {
  // Invoice OCR text
  const { data: invDoc, error: invDocError } = await supabase
    .from('documents')
    .select('mongodb_document_id')
    .eq('id', invoiceDocumentId)
    .eq('org_id', orgId)
    .single();
  if (invDocError) {
    throw new Error(`pre-gather: failed to fetch invoice document ${invoiceDocumentId}: ${invDocError.message}`);
  }
  const invoiceRawText = await fetchMongoText(db, invDoc?.mongodb_document_id);

  // Linked docs from invoice_references (written by linking stage)
  const { data: refs, error: refsError } = await supabase
    .from('invoice_references')
    .select('related_document_id, ref_type')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .not('related_document_id', 'is', null);
  if (refsError) {
    throw new Error(`pre-gather: failed to fetch invoice references for ${invoiceId}: ${refsError.message}`);
  }

  const bolTexts: string[] = [];
  let rateSheetText: string | null = null;

  if (refs?.length) {
    const linkedIds = refs.map((r: { related_document_id: string }) => r.related_document_id);
    const { data: linkedDocs, error: linkedDocsError } = await supabase
      .from('documents')
      .select('id, document_type, mongodb_document_id')
      .eq('org_id', orgId)
      .in('id', linkedIds);
    if (linkedDocsError) {
      throw new Error(`pre-gather: failed to fetch linked documents for invoice ${invoiceId}: ${linkedDocsError.message}`);
    }

    for (const doc of linkedDocs ?? []) {
      const text = await fetchMongoText(db, doc.mongodb_document_id);
      if (doc.document_type === 'BOL') {
        bolTexts.push(text.slice(0, BOL_MAX));
      } else if (doc.document_type === 'RATE_SHEET' && rateSheetText === null) {
        rateSheetText = text.slice(0, RATE_SHEET_MAX);
      }
    }
  }

  // Fallback: rate sheet from rate_sheets table (for carrier-page uploads)
  if (rateSheetText === null) {
    rateSheetText = await fetchRateSheetFallback(supabase, db, orgId, invoiceId);
  }

  return { invoiceRawText, rateSheetText, bolTexts };
}

async function fetchRateSheetFallback(
  supabase: SupabaseClient,
  db: Db,
  orgId: string,
  invoiceId: string
): Promise<string | null> {
  const { data: inv, error: invError } = await supabase
    .from('invoices')
    .select('carrier_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (invError) {
    throw new Error(`pre-gather: failed to fetch invoice ${invoiceId} for rate sheet fallback: ${invError.message}`);
  }
  if (!inv?.carrier_id) return null;

  const { data: sheets, error: sheetsError } = await supabase
    .from('rate_sheets')
    .select('document_id')
    .eq('org_id', orgId)
    .eq('carrier_id', inv.carrier_id)
    .eq('status', 'current')
    .limit(1);
  if (sheetsError) {
    throw new Error(`pre-gather: failed to fetch rate sheets for carrier ${inv.carrier_id}: ${sheetsError.message}`);
  }
  if (!sheets?.length) return null;

  const { data: rsDoc, error: rsDocError } = await supabase
    .from('documents')
    .select('mongodb_document_id')
    .eq('id', sheets[0].document_id)
    .single();
  if (rsDocError) {
    throw new Error(`pre-gather: failed to fetch rate sheet document ${sheets[0].document_id}: ${rsDocError.message}`);
  }

  const text = await fetchMongoText(db, rsDoc?.mongodb_document_id);
  return text ? text.slice(0, RATE_SHEET_MAX) : null;
}
