import { describe, it, expect } from 'vitest';
import { evaluateClassificationGate } from '@/lib/llm/classify-invoice';

describe('evaluateClassificationGate', () => {
  it('fails gate when carrier missing', () => {
    const r = evaluateClassificationGate({
      isFreightInvoice: true,
      carrierName: null,
      invoiceNumber: 'INV-1',
      invoiceTotal: 100,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/carrier/i);
  });
});
