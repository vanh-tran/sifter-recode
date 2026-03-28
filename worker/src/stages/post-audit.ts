import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicChecks } from '@sifter/core/audit/deterministic-checks.js';
import { runAiAuditAgent } from '@sifter/core/audit/ai-audit-agent.js';
import { insertFindingsAndUpdateInvoice } from '@sifter/core/audit/post-audit-db.js';
import type { FindingDraft } from '@sifter/core/audit/types.js';
import type { CheckResult } from '@sifter/core/audit/deterministic-checks.js';

interface PostAuditInput {
  orgId: string;
  invoiceId: string;
  bolDocumentIds: string[];
  rateSheetId: string | null;
}

/**
 * Idempotent: skips if findings already exist for this invoiceId.
 */
export async function runPostAuditStage(
  supabase: SupabaseClient,
  { orgId, invoiceId, bolDocumentIds, rateSheetId }: PostAuditInput
): Promise<void> {
  const { data: existingFindings } = await supabase
    .from('findings')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .limit(1);

  if (existingFindings && existingFindings.length > 0) return;

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, carrier_id, invoice_number, invoice_date, total_amount, created_at')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .single();
  if (invErr) throw new Error(`Failed to load invoice: ${invErr.message}`);

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('amount, description')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId);

  const lineItems = items ?? [];
  const lineSum = lineItems.reduce((s: number, item: { amount: number }) => s + (item.amount ?? 0), 0);
  const lineDescriptions = lineItems.map((item: { description: string }) => item.description ?? '');

  const deterministicResults = runDeterministicChecks({
    lineSum,
    totalAmount: inv.total_amount,
    invoiceDate: new Date(inv.invoice_date),
    receivedAt: new Date(inv.created_at),
    lineDescriptions,
    hasExistingClearedDuplicate: false,
    duplicateDelta: 0,
  });

  let rateSheetJson: unknown = null;
  let bolJson: unknown = null;

  if (rateSheetId) {
    const { data } = await supabase.from('rate_sheets').select('*').eq('id', rateSheetId).eq('org_id', orgId).single();
    rateSheetJson = data ?? null;
  }

  if (bolDocumentIds.length > 0) {
    const { data } = await supabase
      .from('documents')
      .select('id, ref_value, doc_type')
      .eq('org_id', orgId)
      .in('id', bolDocumentIds);
    bolJson = data ?? null;
  }

  const detFindings = deterministicResults
    .filter((r: CheckResult) => r.triggered)
    .map((r: CheckResult): FindingDraft => ({
      finding_type: r.finding_type,
      rule_id: r.rule_id,
      source: 'deterministic',
      severity: 'medium',
      delta_amount: r.delta_amount,
      summary: r.description,
      reasoning: r.description,
    }));

  const findings = await runAiAuditAgent({
    invoiceJson: inv,
    rateSheetJson: rateSheetJson ?? undefined,
    bolJson: bolJson ?? undefined,
    deterministicFindings: detFindings,
  });

  await insertFindingsAndUpdateInvoice(supabase, orgId, invoiceId, findings);
}
