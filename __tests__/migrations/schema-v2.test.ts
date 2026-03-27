import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260326000001_schema_v2.sql'),
  'utf-8'
);

const EXPECTED_TABLES = [
  'organizations',
  'users',
  'memberships',
  'booking_oauth_tokens',
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
  'dispute_documents',
  'dispute_email_threads',
  'cost_operations',
  'jobs',
];

describe('schema_v2 migration', () => {
  it('contains CREATE TABLE IF NOT EXISTS for every v2 table', () => {
    for (const table of EXPECTED_TABLES) {
      expect(SQL).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`)
      );
    }
  });

  it('uses IF NOT EXISTS on every CREATE TABLE', () => {
    const plain = (SQL.match(/CREATE TABLE\s+public\./g) ?? []).length;
    expect(plain).toBe(0);
  });
});
