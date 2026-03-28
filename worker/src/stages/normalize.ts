import type { SupabaseClient } from '@supabase/supabase-js';
import type { Db } from 'mongodb';
import { normalizeInvoiceFromOcr } from '@sifter/core/llm/normalize-invoice.js';

interface NormalizeStageInput {
  orgId: string;
  documentId: string;
  mongoDocId: string;
}

/**
 * Idempotent: skips if an invoice row already exists for this document_id.
 * Returns invoiceId.
 */
export async function runNormalizeStage(
  supabase: SupabaseClient,
  db: Db,
  { orgId, documentId, mongoDocId }: NormalizeStageInput
): Promise<string> {
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('document_id', documentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (existing) return existing.id as string;

  const doc = await db.collection('document_ocr').findOne({ _id: mongoDocId as unknown as import('mongodb').ObjectId });
  const ocrText = (doc?.rawText as string) ?? '';

  const normalized = await normalizeInvoiceFromOcr(ocrText);

  const nameNormalized = normalized.carrierName.trim().toLowerCase();
  const { data: existingCarrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('org_id', orgId)
    .eq('name_normalized', nameNormalized)
    .maybeSingle();

  let carrierId: string;
  if (existingCarrier) {
    carrierId = existingCarrier.id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from('carriers')
      .insert({ org_id: orgId, name_raw: normalized.carrierName, name_normalized: nameNormalized })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert carrier: ${error.message}`);
    carrierId = inserted.id as string;
  }

  const { data: dupInvoice } = await supabase
    .from('invoices')
    .select('id')
    .eq('org_id', orgId)
    .eq('invoice_number', normalized.invoiceNumber)
    .eq('carrier_id', carrierId)
    .eq('total_amount', normalized.totalAmount)
    .maybeSingle();

  if (dupInvoice) {
    await supabase
      .from('invoices')
      .update({ is_duplicate: true, updated_at: new Date().toISOString() })
      .eq('id', dupInvoice.id)
      .eq('org_id', orgId);
    return dupInvoice.id as string;
  }

  const { data: invoice, error: invErr } = await supabase
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

  if (invErr) throw new Error(`Failed to insert invoice: ${invErr.message}`);
  const invoiceId = invoice.id as string;

  if (normalized.lineItems.length > 0) {
    const { error: liErr } = await supabase.from('invoice_line_items').insert(
      normalized.lineItems.map((item) => ({
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
      }))
    );
    if (liErr) throw new Error(`Failed to insert line items: ${liErr.message}`);
  }

  if (normalized.references.length > 0) {
    const { error: refErr } = await supabase.from('invoice_references').insert(
      normalized.references.map((ref) => ({
        org_id: orgId,
        invoice_id: invoiceId,
        ref_type: ref.refType,
        ref_value: ref.refValue,
      }))
    );
    if (refErr) throw new Error(`Failed to insert references: ${refErr.message}`);
  }

  return invoiceId;
}
