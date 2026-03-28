import { describe, it, expect } from 'vitest';
import { evaluateClassificationGate } from '../../packages/core/src/llm/classify-invoice';
import type { ClassificationResult } from '../../packages/core/src/llm/classify-invoice';

const baseRefs = {
  invoiceNumbers: [], bolNumbers: [], proNumbers: [],
  poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null,
};

describe('evaluateClassificationGate', () => {
  it('passes FREIGHT_INVOICE with carrierName', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: 'Acme Freight',
      invoiceNumber: null, invoiceTotal: null, confidence: 0.9,
      extractedRefs: { ...baseRefs, carrierName: 'Acme Freight' },
    };
    expect(evaluateClassificationGate(c).pass).toBe(true);
  });

  it('passes FREIGHT_INVOICE with invoiceNumber but no carrierName', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: null,
      invoiceNumber: 'INV-001', invoiceTotal: null, confidence: 0.8,
      extractedRefs: { ...baseRefs, invoiceNumbers: ['INV-001'] },
    };
    expect(evaluateClassificationGate(c).pass).toBe(true);
  });

  it('rejects FREIGHT_INVOICE missing both carrierName and invoiceNumber', () => {
    const c: ClassificationResult = {
      documentType: 'FREIGHT_INVOICE', carrierName: null,
      invoiceNumber: null, invoiceTotal: 1200, confidence: 0.6,
      extractedRefs: baseRefs,
    };
    const result = evaluateClassificationGate(c);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('carrier name and invoice number');
  });

  it('rejects BOL document type', () => {
    const c: ClassificationResult = {
      documentType: 'BOL', carrierName: 'Acme', invoiceNumber: 'BOL-123',
      invoiceTotal: null, confidence: 0.95, extractedRefs: baseRefs,
    };
    expect(evaluateClassificationGate(c).pass).toBe(false);
    expect(evaluateClassificationGate(c).reason).toContain('BOL');
  });

  it('rejects RATE_SHEET document type', () => {
    const c: ClassificationResult = {
      documentType: 'RATE_SHEET', carrierName: 'Acme', invoiceNumber: null,
      invoiceTotal: null, confidence: 0.9, extractedRefs: baseRefs,
    };
    expect(evaluateClassificationGate(c).pass).toBe(false);
  });
});
