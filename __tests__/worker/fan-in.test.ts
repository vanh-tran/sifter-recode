import { describe, it, expect } from 'vitest';
import { shouldEnqueuePhase2 } from '../../worker/src/stages/fan-in';

describe('shouldEnqueuePhase2', () => {
  it('returns true when count equals sibling_count and freight invoice is known', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(true);
  });

  it('returns false when count is less than sibling_count', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 2, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(false);
  });

  it('returns false when freight_invoice_document_id is null', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: null, phase2_enqueued: false,
    })).toBe(false);
  });

  it('returns false when phase2 already enqueued', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: true,
    })).toBe(false);
  });

  it('returns true when count exceeds sibling_count (last worker won the race)', () => {
    expect(shouldEnqueuePhase2({
      phase1_done_count: 3, sibling_count: 3,
      freight_invoice_document_id: 'doc-123', phase2_enqueued: false,
    })).toBe(true);
  });
});
