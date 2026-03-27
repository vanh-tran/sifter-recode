import { describe, it, expect } from 'vitest';

describe('Inngest client', () => {
  it('exports a named inngest client', async () => {
    const mod = await import('@/lib/inngest/client');
    expect(mod.inngest).toBeDefined();
    expect(typeof mod.inngest.send).toBe('function');
  });

  it('exports event types without throwing', async () => {
    await expect(import('@/lib/inngest/types')).resolves.toBeDefined();
  });
});
