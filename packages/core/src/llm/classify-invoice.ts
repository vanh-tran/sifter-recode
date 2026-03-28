export type ClassificationFields = {
  isFreightInvoice: boolean;
  carrierName: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
};

export function evaluateClassificationGate(c: ClassificationFields): { pass: boolean; reason?: string } {
  if (!c.isFreightInvoice) return { pass: false, reason: 'Not classified as freight invoice' };
  if (!c.carrierName?.trim()) return { pass: false, reason: 'Missing carrier name' };
  if (!c.invoiceNumber?.trim()) return { pass: false, reason: 'Missing invoice number' };
  if (c.invoiceTotal == null || Number.isNaN(c.invoiceTotal)) return { pass: false, reason: 'Missing invoice total' };
  return { pass: true };
}

export const CLASSIFY_FREIGHT_INVOICE_PROMPT = `You are a document classifier for accounts payable.
Given raw OCR text from a PDF, return a JSON object with keys:
- isFreightInvoice (boolean): true only if this is a freight / logistics carrier invoice (not a quote, not a receipt unless it is clearly an invoice).
- carrierName (string|null)
- invoiceNumber (string|null)
- invoiceTotal (number|null): total amount due in USD if stated; else null
- confidence (number 0-1)

Rules: If unsure, set isFreightInvoice to false. Do not invent numbers; extract only from text.`;

export async function classifyFreightInvoiceFromText(
  rawText: string,
  callOpenAI: (prompt: string) => Promise<string>
): Promise<ClassificationFields & { confidence: number }> {
  const raw = await callOpenAI(
    `${CLASSIFY_FREIGHT_INVOICE_PROMPT}\n\n--- OCR TEXT ---\n${rawText.slice(0, 120_000)}`
  );
  const parsed = JSON.parse(raw) as ClassificationFields & { confidence: number };
  return parsed;
}
