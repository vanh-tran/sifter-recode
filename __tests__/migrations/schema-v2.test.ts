import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'docs/database/schema-v2.sql'),
  'utf-8'
);

/** Tables declared in docs/database/schema-v2.sql (source of truth for v2 shape). */
const EXPECTED_TABLES = [
  'organizations',
  'users',
  'memberships',
  'email_connections',
  'oauth_tokens',
  'oauth_sessions',
  'documents',
  'carriers',
  'rate_sheets',
  'invoices',
  'invoice_line_items',
  'invoice_references',
  'findings',
  'finding_line_items',
  'proof_clips',
  'disputes',
  'dispute_messages',
  'cost_operations',
  'jobs',
];

describe('schema v2 (docs/database/schema-v2.sql)', () => {
  it('contains CREATE TABLE public.<name> for every v2 table', () => {
    for (const table of EXPECTED_TABLES) {
      expect(SQL).toMatch(
        new RegExp(`CREATE TABLE (IF NOT EXISTS )?public\\.${table}\\b`)
      );
    }
  });
});
