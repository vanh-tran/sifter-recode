// worker/src/stages/link-documents.ts
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedRefs } from '@sifter/core/llm/classify-invoice';

export interface CandidateDoc {
  documentId: string;
  documentType: string;
  filename: string;
  extractedRefs: ExtractedRefs | null;
  sourceThreadId: string | null;
}

interface LinkSuggestion {
  documentId: string;
  refType: 'BOL' | 'RATE_SHEET' | 'LUMPER_RECEIPT' | 'DETENTION_NOTICE' | 'OTHER';
  linkConfidence: number;
  reasoning: string;
}

export function mergeCandidatesByDocumentId(groups: CandidateDoc[][]): CandidateDoc[] {
  const seen = new Map<string, CandidateDoc>();
  for (const group of groups) {
    for (const doc of group) {
      if (!seen.has(doc.documentId)) seen.set(doc.documentId, doc);
    }
  }
  return Array.from(seen.values());
}

export function refsOverlap(a: ExtractedRefs, b: ExtractedRefs): boolean {
  const flatten = (r: ExtractedRefs) =>
    [...r.invoiceNumbers, ...r.bolNumbers, ...r.proNumbers, ...r.poNumbers, ...r.trackingNumbers]
      .map(s => s.toLowerCase())
      .filter(Boolean);
  const setA = new Set(flatten(a));
  return flatten(b).some(v => setA.has(v));
}

const LINKING_PROMPT = `You are a document linking agent for freight invoice auditing.
Given a freight invoice and a list of candidate supporting documents, determine which are related to this specific invoice.
Return JSON: { "links": Array<{ documentId: string, refType: "BOL"|"RATE_SHEET"|"LUMPER_RECEIPT"|"DETENTION_NOTICE"|"OTHER", linkConfidence: number, reasoning: string }> }
Include any candidate with linkConfidence >= 0.3. The audit agent handles final relevance — prefer false positives over misses.`;

type SupabaseDocRow = {
  id: string;
  document_type: string;
  filename: string;
  extracted_refs: ExtractedRefs | null;
  source_thread_id: string | null;
};

export async function runLinkDocumentsStage(
  supabase: SupabaseClient,
  {
    orgId,
    invoiceId,
    invoiceDocumentId,
    invoiceExtractedRefs,
    invoiceCarrierId,
    invoiceDate,
    sourceThreadId,
  }: {
    orgId: string;
    invoiceId: string;
    invoiceDocumentId: string;
    invoiceExtractedRefs: ExtractedRefs;
    invoiceCarrierId: string | null;
    invoiceDate: string | null;
    sourceThreadId: string | null;
  }
): Promise<void> {
  const toCandidate = (d: SupabaseDocRow): CandidateDoc => ({
    documentId: d.id,
    documentType: d.document_type,
    filename: d.filename,
    extractedRefs: d.extracted_refs,
    sourceThreadId: d.source_thread_id,
  });

  // Group 1: same thread
  let group1: CandidateDoc[] = [];
  if (sourceThreadId) {
    const { data } = await supabase
      .from('documents')
      .select('id, document_type, filename, extracted_refs, source_thread_id')
      .eq('org_id', orgId)
      .eq('source_thread_id', sourceThreadId)
      .neq('id', invoiceDocumentId)
      .neq('document_type', 'OTHER');
    group1 = (data ?? []).map(toCandidate);
  }

  // Group 2: ref cross-match (last 90 days)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentDocs } = await supabase
    .from('documents')
    .select('id, document_type, filename, extracted_refs, source_thread_id')
    .eq('org_id', orgId)
    .neq('id', invoiceDocumentId)
    .neq('document_type', 'OTHER')
    .not('extracted_refs', 'is', null)
    .gte('created_at', cutoff);
  const group2: CandidateDoc[] = (recentDocs ?? [])
    .filter((d: SupabaseDocRow) => d.extracted_refs && refsOverlap(invoiceExtractedRefs, d.extracted_refs))
    .map(toCandidate);

  // Group 3: carrier + date window (±7 days)
  let group3: CandidateDoc[] = [];
  if (invoiceCarrierId && invoiceDate && invoiceExtractedRefs.carrierName) {
    const base = new Date(invoiceDate);
    const min = new Date(base); min.setDate(min.getDate() - 7);
    const max = new Date(base); max.setDate(max.getDate() + 7);
    const carrierLower = invoiceExtractedRefs.carrierName.toLowerCase();

    const { data: carrierDocs } = await supabase
      .from('documents')
      .select('id, document_type, filename, extracted_refs, source_thread_id')
      .eq('org_id', orgId)
      .neq('id', invoiceDocumentId)
      .neq('document_type', 'OTHER')
      .not('extracted_refs', 'is', null)
      .gte('created_at', cutoff);

    group3 = (carrierDocs ?? [])
      .filter((d: SupabaseDocRow) => {
        const refs = d.extracted_refs;
        if (!refs?.shipmentDate || !refs.carrierName) return false;
        const shipDate = new Date(refs.shipmentDate);
        return (
          refs.carrierName.toLowerCase().includes(carrierLower) &&
          shipDate >= min && shipDate <= max
        );
      })
      .map(toCandidate);
  }

  const candidates = mergeCandidatesByDocumentId([group1, group2, group3]);
  if (candidates.length === 0) return;

  // Call linking agent
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const contextJson = JSON.stringify({
    invoice: { invoiceDate, extractedRefs: invoiceExtractedRefs },
    candidates,
  });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `${LINKING_PROMPT}\n\nCONTEXT:\n${contextJson.slice(0, 80_000)}` }],
  });
  const raw = res.choices[0]?.message?.content ?? '{"links":[]}';

  let parsed: { links: LinkSuggestion[] };
  try {
    parsed = JSON.parse(raw) as { links: LinkSuggestion[] };
  } catch {
    throw new Error(`link-documents: failed to parse LLM response as JSON. Raw: ${raw.slice(0, 500)}`);
  }

  const { links } = parsed;
  if (!links.length) return;

  // Delete old ai-linked refs, insert fresh ones
  const { error: deleteError } = await supabase
    .from('invoice_references')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .eq('link_method', 'ai')
    .not('related_document_id', 'is', null);

  if (deleteError) {
    throw new Error(`link-documents: failed to delete old AI links for invoice ${invoiceId}: ${deleteError.message}`);
  }

  const rows = links
    .filter(l => l.linkConfidence >= 0.3)
    .filter(l => candidates.some(c => c.documentId === l.documentId))
    .map(l => {
      const candidate = candidates.find(c => c.documentId === l.documentId);
      return {
        org_id: orgId,
        invoice_id: invoiceId,
        ref_type: l.refType,
        ref_value: candidate?.filename ?? l.documentId,
        related_document_id: l.documentId,
        link_confidence: l.linkConfidence,
        link_method: 'ai',
      };
    });

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('invoice_references').insert(rows);
    if (insertError) {
      throw new Error(`link-documents: failed to insert AI links for invoice ${invoiceId}: ${insertError.message}`);
    }
  }
}
