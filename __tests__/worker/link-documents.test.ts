// __tests__/worker/link-documents.test.ts
import { describe, it, expect } from 'vitest';
import { mergeCandidatesByDocumentId, refsOverlap } from '../../worker/src/stages/link-documents';

const makeDoc = (id: string) => ({
  documentId: id, documentType: 'BOL', filename: `${id}.pdf`,
  extractedRefs: null, sourceThreadId: null,
});

describe('mergeCandidatesByDocumentId', () => {
  it('deduplicates a doc appearing in two groups', () => {
    const result = mergeCandidatesByDocumentId([
      [makeDoc('doc-1')],
      [makeDoc('doc-1'), makeDoc('doc-2')],
    ]);
    expect(result).toHaveLength(2);
    expect(result.map(d => d.documentId).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('returns empty when all groups are empty', () => {
    expect(mergeCandidatesByDocumentId([[], []])).toHaveLength(0);
  });

  it('preserves first occurrence when same doc in multiple groups', () => {
    const doc1a = { ...makeDoc('doc-1'), documentType: 'BOL' };
    const doc1b = { ...makeDoc('doc-1'), documentType: 'RATE_SHEET' };
    const result = mergeCandidatesByDocumentId([[doc1a], [doc1b]]);
    expect(result[0].documentType).toBe('BOL');
  });
});

describe('refsOverlap', () => {
  const base = { invoiceNumbers: [], bolNumbers: [], proNumbers: [], poNumbers: [], trackingNumbers: [], carrierName: null, shipmentDate: null };

  it('returns true when invoice numbers overlap', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['INV-001'] },
      { ...base, invoiceNumbers: ['INV-001', 'INV-002'] }
    )).toBe(true);
  });

  it('returns true when BOL number in one matches invoice number in the other', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['BOL-999'] },
      { ...base, bolNumbers: ['BOL-999'] }
    )).toBe(true);
  });

  it('returns false when no overlap', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['INV-001'] },
      { ...base, invoiceNumbers: ['INV-999'] }
    )).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(refsOverlap(
      { ...base, invoiceNumbers: ['inv-001'] },
      { ...base, invoiceNumbers: ['INV-001'] }
    )).toBe(true);
  });
});
