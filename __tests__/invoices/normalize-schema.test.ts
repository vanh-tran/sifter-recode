import { describe, it, expect } from 'vitest';
import { NormalizedInvoiceSchema } from '@/lib/invoices/normalize-schema';

describe('NormalizedInvoiceSchema', () => {
  it('parses minimal valid object', () => {
    const v = NormalizedInvoiceSchema.parse({
      carrierName: 'Acme Trucking',
      invoiceNumber: 'INV-9',
      invoiceDate: '2025-01-15',
      currency: 'USD',
      totalAmount: 100,
      lineItems: [],
      references: [],
    });
    expect(v.invoiceNumber).toBe('INV-9');
  });
});
