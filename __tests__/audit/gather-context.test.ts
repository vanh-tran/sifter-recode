import { describe, it, expect } from 'vitest';
import { pickLatestRateSheet } from '@/lib/audit/gather-context';

describe('pickLatestRateSheet', () => {
  it('picks max effective_date', () => {
    const rows = [
      { id: 'a', effective_date: '2024-01-01' },
      { id: 'b', effective_date: '2025-06-01' },
    ];
    expect(pickLatestRateSheet(rows)?.id).toBe('b');
  });
});
