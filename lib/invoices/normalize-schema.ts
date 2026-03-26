import { z } from 'zod';

export const LineItemSchema = z.object({
  lineNumber: z.number().optional(),
  code: z.string().nullable().optional(),
  description: z.string(),
  qty: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  amount: z.number(),
  chargeType: z.string().nullable().optional(),
});

export const ReferenceSchema = z.object({
  refType: z.enum(['BOL', 'PRO', 'TRACKING', 'PO', 'LOAD', 'QUOTE', 'OTHER']),
  refValue: z.string(),
});

export const NormalizedInvoiceSchema = z.object({
  carrierName: z.string(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().default('USD'),
  subtotalAmount: z.number().nullable().optional(),
  taxAmount: z.number().nullable().optional(),
  totalAmount: z.number(),
  paymentTermsText: z.string().nullable().optional(),
  lineItems: z.array(LineItemSchema),
  references: z.array(ReferenceSchema),
});

export type NormalizedInvoice = z.infer<typeof NormalizedInvoiceSchema>;
