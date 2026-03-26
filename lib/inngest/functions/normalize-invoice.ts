import { inngest } from '@/lib/inngest/client';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { getMongoDb } from '@/lib/mongodb/client';
import { normalizeInvoiceFromOcr } from '@/lib/llm/normalize-invoice';
import type { SifterEvents } from '@/lib/inngest/types';

export const normalizeInvoice = inngest.createFunction(
  { id: 'normalize-invoice', name: 'Normalize Invoice (LLM)', triggers: [{ event: 'sifter/document.classified' }] },
  async ({ event, step }) => {
    const { orgId, documentId, mongodbDocumentId } = event.data;
    const supabase = createServiceRoleClient();

    // Load OCR text from MongoDB
    const ocrText = await step.run('load-ocr', async () => {
      const db = await getMongoDb();
      const doc = await db.collection('document_ocr').findOne({ _id: mongodbDocumentId });
      return (doc?.rawText as string) ?? '';
    });

    // Call LLM to normalize invoice data
    const normalized = await step.run('llm-normalize', async () => {
      return normalizeInvoiceFromOcr(ocrText);
    });

    // Upsert carrier
    const carrierId = await step.run('upsert-carrier', async () => {
      const nameNormalized = normalized.carrierName.trim().toLowerCase();

      const { data: existing } = await supabase
        .from('carriers')
        .select('id')
        .eq('org_id', orgId)
        .eq('name_normalized', nameNormalized)
        .maybeSingle();

      if (existing) {
        return existing.id as string;
      }

      const { data: inserted, error } = await supabase
        .from('carriers')
        .insert({
          org_id: orgId,
          name_raw: normalized.carrierName,
          name_normalized: nameNormalized,
        })
        .select('id')
        .single();

      if (error) throw new Error(`Failed to insert carrier: ${error.message}`);
      return inserted.id as string;
    });

    // Check for duplicate invoice and insert
    const invoiceResult = await step.run('insert-invoice', async () => {
      // Dedup check: same invoice_number + carrier_id + total_amount within org
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('org_id', orgId)
        .eq('invoice_number', normalized.invoiceNumber)
        .eq('carrier_id', carrierId)
        .eq('total_amount', normalized.totalAmount)
        .maybeSingle();

      if (existing) {
        return { invoiceId: existing.id as string, isDuplicate: true };
      }

      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          org_id: orgId,
          document_id: documentId,
          carrier_id: carrierId,
          invoice_number: normalized.invoiceNumber,
          invoice_date: normalized.invoiceDate,
          due_date: normalized.dueDate ?? null,
          currency: normalized.currency,
          subtotal_amount: normalized.subtotalAmount ?? null,
          tax_amount: normalized.taxAmount ?? null,
          total_amount: normalized.totalAmount,
          payment_terms_text: normalized.paymentTermsText ?? null,
          ui_status: 'new',
          is_duplicate: false,
        })
        .select('id')
        .single();

      if (error) throw new Error(`Failed to insert invoice: ${error.message}`);
      return { invoiceId: invoice.id as string, isDuplicate: false };
    });

    const { invoiceId, isDuplicate } = invoiceResult;

    // Mark duplicate and skip further steps if detected
    if (isDuplicate) {
      await step.run('mark-duplicate', async () => {
        await supabase
          .from('invoices')
          .update({ is_duplicate: true, updated_at: new Date().toISOString() })
          .eq('id', invoiceId)
          .eq('org_id', orgId);
      });

      return { status: 'skipped', reason: 'duplicate', invoiceId };
    }

    // Insert line items
    if (normalized.lineItems.length > 0) {
      await step.run('insert-line-items', async () => {
        const rows = normalized.lineItems.map((item) => ({
          org_id: orgId,
          invoice_id: invoiceId,
          line_number: item.lineNumber ?? null,
          code: item.code ?? null,
          description: item.description,
          qty: item.qty ?? null,
          unit: item.unit ?? null,
          rate: item.rate ?? null,
          amount: item.amount,
          charge_type: item.chargeType ?? null,
        }));

        const { error } = await supabase.from('invoice_line_items').insert(rows);
        if (error) throw new Error(`Failed to insert line items: ${error.message}`);
      });
    }

    // Insert references
    if (normalized.references.length > 0) {
      await step.run('insert-references', async () => {
        const rows = normalized.references.map((ref) => ({
          org_id: orgId,
          invoice_id: invoiceId,
          ref_type: ref.refType,
          ref_value: ref.refValue,
        }));

        const { error } = await supabase.from('invoice_references').insert(rows);
        if (error) throw new Error(`Failed to insert references: ${error.message}`);
      });
    }

    // Update document processing status to completed
    await step.run('mark-document-complete', async () => {
      await supabase
        .from('documents')
        .update({ processing_status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('org_id', orgId);
    });

    await step.sendEvent('emit-normalized', {
      name: 'sifter/invoice.normalized',
      data: { orgId, invoiceId },
    });

    return { status: 'ok', invoiceId };
  }
);
