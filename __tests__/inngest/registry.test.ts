import { describe, it, expect } from 'vitest';

describe('inngest function registry', () => {
  it('exports a non-empty functions array', async () => {
    const { inngestFunctions } = await import('@/lib/inngest/functions');
    expect(Array.isArray(inngestFunctions)).toBe(true);
    expect(inngestFunctions.length).toBeGreaterThan(0);
  });
});
