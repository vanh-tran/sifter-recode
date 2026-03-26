import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { runDeterministicChecks } from '@/lib/audit/deterministic-checks';
import { runAiAuditAgent } from '@/lib/audit/ai-audit-agent';
import { insertFindingsAndUpdateInvoice } from '@/lib/inngest/lib/post-audit-db';
import type { FindingDraft } from '@/lib/audit/types';
import type { CheckResult } from '@/lib/audit/deterministic-checks';

export const postAudit = inngest.createFunction(
  { id: 'post-audit', name: 'Post-Audit: Persist Findings + Invoice Status', triggers: [{ event: 'sifter/invoice.context_ready' }] },
  async ({ event, step }) => {
    const { orgId, invoiceId, bolDocumentIds, rateSheetId } = event.data;
    const supabase = createServiceRoleClient();

    // Load invoice + line items from Supabase
    const { invoice, lineItems } = await step.run('load-invoice-line-items', async () => {
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

      return { invoice: inv, lineItems: items ?? [] };
    });

    // Run deterministic checks
    const deterministicResults = await step.run('deterministic-checks', async () => {
      const lineSum = lineItems.reduce((s: number, item: { amount: number }) => s + (item.amount ?? 0), 0);
      const lineDescriptions = lineItems.map((item: { description: string }) => item.description ?? '');
      const invoiceDate = new Date(invoice.invoice_date);
      const receivedAt = new Date(invoice.created_at);

      return runDeterministicChecks({
        lineSum,
        totalAmount: invoice.total_amount,
        invoiceDate,
        receivedAt,
        lineDescriptions,
        hasExistingClearedDuplicate: false,
        duplicateDelta: 0,
      });
    });

    // Load rate sheet and BOL context for AI
    const { rateSheetJson, bolJson } = await step.run('load-context-documents', async () => {
      let rsJson: unknown = null;
      let bJson: unknown = null;

      if (rateSheetId) {
        const { data } = await supabase
          .from('rate_sheets')
          .select('*')
          .eq('id', rateSheetId)
          .eq('org_id', orgId)
          .single();
        rsJson = data ?? null;
      }

      if (bolDocumentIds.length > 0) {
        const { data } = await supabase
          .from('documents')
          .select('id, ref_value, doc_type')
          .eq('org_id', orgId)
          .in('id', bolDocumentIds);
        bJson = data ?? null;
      }

      return { rateSheetJson: rsJson, bolJson: bJson };
    });

    // Run AI audit agent
    const findings = await step.run('ai-audit', async () => {
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

      return runAiAuditAgent({
        invoiceJson: invoice,
        rateSheetJson: rateSheetJson ?? undefined,
        bolJson: bolJson ?? undefined,
        deterministicFindings: detFindings,
      });
    });

    // Persist findings + update invoice status
    await step.run('persist-findings', async () => {
      await insertFindingsAndUpdateInvoice(supabase, orgId, invoiceId, findings);
    });

    // Emit sifter/invoice.audited
    await step.sendEvent('emit-audited', {
      name: 'sifter/invoice.audited',
      data: {
        orgId,
        invoiceId,
        findingCount: findings.length,
      },
    });

    return { status: 'ok', invoiceId, findingCount: findings.length };
  }
);
