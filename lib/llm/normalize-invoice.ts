import OpenAI from 'openai';
import { NormalizedInvoiceSchema, type NormalizedInvoice } from '@/lib/invoices/normalize-schema';

export const NORMALIZE_INVOICE_PROMPT = `You extract structured data from freight invoice OCR text.
Return JSON matching this TypeScript interface:
{
  carrierName: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO date yyyy-mm-dd
  dueDate?: string | null;
  currency: string; // default USD
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
  paymentTermsText?: string | null;
  lineItems: Array<{
    lineNumber?: number;
    code?: string | null;
    description: string;
    qty?: number | null;
    unit?: string | null;
    rate?: number | null;
    amount: number;
    chargeType?: string | null;
  }>;
  references: Array<{
    refType: 'BOL'|'PRO'|'TRACKING'|'PO'|'LOAD'|'QUOTE'|'OTHER';
    refValue: string;
  }>;
}
Rules: Use only information present in the text. Do not guess totals; if unclear, pick the labeled "Total" or "Amount Due".`;

export async function normalizeInvoiceFromOcr(ocrText: string): Promise<NormalizedInvoice> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: `${NORMALIZE_INVOICE_PROMPT}\n\n--- OCR ---\n${ocrText.slice(0, 120_000)}` }],
  });
  const raw = res.choices[0]?.message?.content ?? '{}';
  return NormalizedInvoiceSchema.parse(JSON.parse(raw));
}
