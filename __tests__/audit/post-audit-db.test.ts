import { describe, it, expect } from 'vitest';
import { sumDeltaAmounts } from '@sifter/core/audit/post-audit-db';

describe('sumDeltaAmounts', () => {
  it('sums deltas', () => {
    expect(sumDeltaAmounts([{ delta_amount: 1 }, { delta_amount: 2.5 }])).toBe(3.5);
  });
});
