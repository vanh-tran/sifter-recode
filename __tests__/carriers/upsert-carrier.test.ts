import { describe, it, expect } from 'vitest';
import { normalizeCarrierName } from '@/lib/carriers/upsert';

describe('normalizeCarrierName', () => {
  it('lowercases and trims', () => {
    expect(normalizeCarrierName('  Acme LLC  ')).toBe('acme llc');
  });
});
