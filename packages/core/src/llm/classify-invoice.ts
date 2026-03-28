export type DocumentType =
  | 'FREIGHT_INVOICE'
  | 'BOL'
  | 'RATE_SHEET'
  | 'LUMPER_RECEIPT'
  | 'DETENTION_NOTICE'
  | 'OTHER';

export interface ExtractedRefs {
  invoiceNumbers: string[];
  bolNumbers: string[];
  proNumbers: string[];
  poNumbers: string[];
  trackingNumbers: string[];
  carrierName: string | null;
  shipmentDate: string | null;
}

export interface ClassificationResult {
  documentType: DocumentType;
  carrierName: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  confidence: number;
  extractedRefs: ExtractedRefs;
}

export function evaluateClassificationGate(c: ClassificationResult): { pass: boolean; reason?: string } {
  if (c.documentType !== 'FREIGHT_INVOICE') {
    return { pass: false, reason: `Document classified as ${c.documentType}` };
  }
  if (!c.carrierName?.trim() && !c.invoiceNumber?.trim()) {
    return { pass: false, reason: 'Missing both carrier name and invoice number' };
  }
  return { pass: true };
}

export const CLASSIFY_DOCUMENT_PROMPT = `You are a document classifier for accounts payable.
Given raw OCR text from a PDF, return a JSON object with these keys:

documentType (string): the most specific type from:
  FREIGHT_INVOICE — a freight/logistics carrier invoice containing line item charges, amounts, or billing references. Lean toward this type if the document looks like an invoice, even if some fields are missing.
  BOL — Bill of Lading or proof of delivery document
  RATE_SHEET — carrier rate card or tariff schedule
  LUMPER_RECEIPT — lumper or unloading service receipt
  DETENTION_NOTICE — detention or layover notice
  OTHER — only if clearly none of the above

carrierName (string|null): carrier or logistics company name, if present
invoiceNumber (string|null): invoice or billing reference number, if present
invoiceTotal (number|null): total amount due in USD, if stated; else null
confidence (number 0-1): your confidence in the classification

extractedRefs (object): all reference identifiers found in the document:
  invoiceNumbers: string[]
  bolNumbers: string[]
  proNumbers: string[]
  poNumbers: string[]
  trackingNumbers: string[]
  carrierName: string|null
  shipmentDate: string|null  (ISO 8601 date if found, else null)

Do not invent values. Extract only what is present in the OCR text.`;

export async function classifyDocument(
  rawText: string,
  callOpenAI: (prompt: string) => Promise<string>
): Promise<ClassificationResult> {
  const raw = await callOpenAI(
    `${CLASSIFY_DOCUMENT_PROMPT}\n\n--- OCR TEXT ---\n${rawText.slice(0, 120_000)}`
  );
  return JSON.parse(raw) as ClassificationResult;
}
