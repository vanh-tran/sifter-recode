import type { SupabaseClient } from '@supabase/supabase-js';
import { pickLatestRateSheet } from '@sifter/core/audit/gather-context';

interface GatherContextInput {
  orgId: string;
  invoiceId: string;
}

interface GatherContextResult {
  bolDocumentIds: string[];
  rateSheetId: string | null;
}

/**
 * Always runs — reads are idempotent. Finds BOL docs and latest rate sheet.
 */
export async function runGatherContextStage(
  supabase: SupabaseClient,
  { orgId, invoiceId }: GatherContextInput
): Promise<GatherContextResult> {
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, carrier_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();

  const { data: refs } = await supabase
    .from('invoice_references')
    .select('related_document_id')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .eq('ref_type', 'BOL')
    .not('related_document_id', 'is', null);

  const bolDocumentIds = (refs ?? [])
    .map((r: { related_document_id: string }) => r.related_document_id)
    .filter(Boolean);

  let rateSheetId: string | null = null;
  if (inv?.carrier_id) {
    const { data: rateSheets } = await supabase
      .from('rate_sheets')
      .select('id, effective_date')
      .eq('org_id', orgId)
      .eq('carrier_id', inv.carrier_id);
    rateSheetId = pickLatestRateSheet(rateSheets ?? [])?.id ?? null;
  }

  return { bolDocumentIds, rateSheetId };
}
