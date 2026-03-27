import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(
  join(process.cwd(), 'app/api/findings/route.ts'),
  'utf-8'
);

describe('GET /api/findings column names', () => {
  it('selects finding_type (v2 name)', () => {
    expect(SRC).toContain('finding_type');
  });

  it('selects description_edited', () => {
    expect(SRC).toContain('description_edited');
  });

  it('selects amount_edited', () => {
    expect(SRC).toContain('amount_edited');
  });

  it('does NOT reference the stale leak_type column in the SELECT block', () => {
    const selectBlock = SRC.match(/\.select\(`([\s\S]*?)`\)/)?.[1] ?? '';
    expect(selectBlock).not.toContain('leak_type');
  });
});
