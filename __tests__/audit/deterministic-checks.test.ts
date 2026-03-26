import { describe, it, expect } from 'vitest';
import { mathErrorCheck } from '@/lib/audit/deterministic-checks';

describe('mathErrorCheck', () => {
  it('triggers when line sum differs from total beyond tolerance', () => {
    const r = mathErrorCheck({
      lineSum: 100.02,
      totalAmount: 200,
      tolerance: 0.01,
    });
    expect(r.triggered).toBe(true);
    expect(r.finding_type).toBe('math_error');
  });
});
