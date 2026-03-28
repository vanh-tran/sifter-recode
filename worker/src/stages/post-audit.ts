// worker/src/stages/post-audit.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { runDeterministicChecks } from '@sifter/core/audit/deterministic-checks';
import { runAiAuditAgent } from '@sifter/core/audit/ai-audit-agent';
import { insertFindingsAndUpdateInvoice } from '@sifter/core/audit/post-audit-db';
import type { FindingDraft } from '@sifter/core/audit/types';
import type { CheckResult } from '@sifter/core/audit/deterministic-checks';
import type { PreGatheredContext } from './pre-gather.js';

interface PostAuditInput {
  orgId: string;
  invoiceId: string;
  preGatheredContext: PreGatheredContext;
}

/**
 * Idempotent: skips if findings already exist for this invoiceId.
 * For re-audit, caller deletes findings first.
 */
export async function runPostAuditStage(
  supabase: SupabaseClient,
  { orgId, invoiceId, preGatheredContext }: PostAuditInput
): Promise<void> {
  const { data: existingFindings } = await supabase
    .from('findings').select('id').eq('invoice_id', invoiceId).eq('org_id', orgId).limit(1);
  if (existingFindings && existingFindings.length > 0) return;

  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('id, carrier_id, invoice_number, invoice_date, total_amount, created_at')
    .eq('id', invoiceId).eq('org_id', orgId).single();
  if (invErr) throw new Error(`Failed to load invoice: ${invErr.message}`);

  const { data: items } = await supabase
    .from('invoice_line_items').select('amount, description')
    .eq('invoice_id', invoiceId).eq('org_id', orgId);

  const lineItems = items ?? [];
  const lineSum = lineItems.reduce((s: number, i: { amount: number }) => s + (i.amount ?? 0), 0);
  const lineDescriptions = lineItems.map((i: { description: string }) => i.description ?? '');

  const deterministicResults = runDeterministicChecks({
    lineSum,
    totalAmount: inv.total_amount,
    invoiceDate: new Date(inv.invoice_date),
    receivedAt: new Date(inv.created_at),
    lineDescriptions,
    hasExistingClearedDuplicate: false,
    duplicateDelta: 0,
  });

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
    invoiceJson: { ...inv, lineItems },
    invoiceRawText: preGatheredContext.invoiceRawText,
    rateSheetText: preGatheredContext.rateSheetText ?? undefined,
    bolTexts: preGatheredContext.bolTexts.length > 0 ? preGatheredContext.bolTexts : undefined,
    deterministicFindings: detFindings,
  });

  await insertFindingsAndUpdateInvoice(supabase, orgId, invoiceId, findings);
}
