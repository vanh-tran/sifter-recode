import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { pickLatestRateSheet } from '@/lib/audit/gather-context';

export const gatherContext = inngest.createFunction(
  { id: 'gather-context', name: 'Gather BOL and Rate Sheet Context', triggers: [{ event: 'sifter/invoice.normalized' }] },
  async ({ event, step }) => {
    const { orgId, invoiceId } = event.data;
    const supabase = createServiceRoleClient();

    // Load invoice + references from Supabase
    const { invoice, references } = await step.run('load-invoice-references', async () => {
      const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .select('id, carrier_id, invoice_number')
        .eq('id', invoiceId)
        .eq('org_id', orgId)
        .single();
      if (invErr) throw new Error(`Failed to load invoice: ${invErr.message}`);

      const { data: refs } = await supabase
        .from('invoice_references')
        .select('ref_type, ref_value')
        .eq('invoice_id', invoiceId)
        .eq('org_id', orgId);

      return { invoice: inv, references: refs ?? [] };
    });

    // Find BOL documents by ref_value match
    const bolDocumentIds = await step.run('find-bol-documents', async () => {
      const refValues = references.map((r: { ref_value: string }) => r.ref_value).filter(Boolean);
      if (!refValues.length) return [];

      const { data: docs } = await supabase
        .from('documents')
        .select('id')
        .eq('org_id', orgId)
        .eq('doc_type', 'bol')
        .in('ref_value', refValues);

      return (docs ?? []).map((d: { id: string }) => d.id);
    });

    // Load rate sheets for carrier_id using pickLatestRateSheet
    const rateSheetId = await step.run('find-rate-sheet', async () => {
      if (!invoice.carrier_id) return null;

      const { data: rateSheets } = await supabase
        .from('rate_sheets')
        .select('id, effective_date')
        .eq('org_id', orgId)
        .eq('carrier_id', invoice.carrier_id);

      const latest = pickLatestRateSheet(rateSheets ?? []);
      return latest?.id ?? null;
    });

    // Emit sifter/invoice.context_ready
    await step.sendEvent('emit-context-ready', {
      name: 'sifter/invoice.context_ready',
      data: {
        orgId,
        invoiceId,
        bolDocumentIds,
        rateSheetId,
      },
    });

    return { status: 'ok', invoiceId, bolDocumentIds, rateSheetId };
  }
);
