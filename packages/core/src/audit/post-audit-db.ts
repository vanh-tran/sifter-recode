import type { FindingDraft } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export function sumDeltaAmounts(rows: { delta_amount: number }[]): number {
  return rows.reduce((s, r) => s + r.delta_amount, 0);
}

export async function insertFindingsAndUpdateInvoice(
  supabase: SupabaseClient,
  orgId: string,
  invoiceId: string,
  findings: FindingDraft[]
) {
  const overcharge = sumDeltaAmounts(findings);
  for (const f of findings) {
    await supabase.from('findings').insert({
      org_id: orgId,
      invoice_id: invoiceId,
      finding_type: f.finding_type,
      rule_id: f.rule_id,
      source: f.source,
      severity: f.severity,
      expected_amount: f.expected_amount ?? null,
      charged_amount: f.charged_amount ?? null,
      delta_amount: f.delta_amount,
      summary: f.summary,
      reasoning: f.reasoning,
      confidence: f.confidence ?? null,
      evidence_json: f.evidence_json ?? null,
    });
  }
  const ui_status = findings.length === 0 ? 'no_findings' : 'action_needed';
  await supabase
    .from('invoices')
    .update({ overcharge_amount: overcharge, ui_status, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('org_id', orgId);

  const { data: inv } = await supabase
    .from('invoices')
    .select('document_id')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();

  if (inv?.document_id) {
    await supabase
      .from('documents')
      .update({ processing_status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', inv.document_id)
      .eq('org_id', orgId);
  }
}
