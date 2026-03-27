import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission } from '@/lib/server/rbac';
import { NextResponse } from 'next/server';

describe('hasPermission', () => {
  it('viewer can read invoices', () => {
    expect(hasPermission('viewer', 'invoices:read')).toBe(true);
  });
  it('viewer cannot manage invoices', () => {
    expect(hasPermission('viewer', 'invoices:manage')).toBe(false);
  });
  it('viewer cannot manage org settings', () => {
    expect(hasPermission('viewer', 'org:settings')).toBe(false);
  });

  it('member can read findings', () => {
    expect(hasPermission('member', 'findings:read')).toBe(true);
  });
  it('member can manage invoices', () => {
    expect(hasPermission('member', 'invoices:manage')).toBe(true);
  });
  it('member cannot manage carriers', () => {
    expect(hasPermission('member', 'carriers:manage')).toBe(false);
  });

  it('admin can manage carriers', () => {
    expect(hasPermission('admin', 'carriers:manage')).toBe(true);
  });
  it('admin cannot change org settings', () => {
    expect(hasPermission('admin', 'org:settings')).toBe(false);
  });

  it('owner can do everything', () => {
    const permissions = [
      'invoices:read',
      'findings:read',
      'invoices:manage',
      'disputes:create',
      'disputes:send',
      'documents:upload',
      'carriers:manage',
      'mailboxes:manage',
      'team:manage',
      'org:settings',
    ] as const;
    for (const p of permissions) {
      expect(hasPermission('owner', p)).toBe(true);
    }
  });
});

describe('requirePermission', () => {
  it('returns null when role has permission', () => {
    const result = requirePermission('admin', 'invoices:read');
    expect(result).toBeNull();
  });

  it('returns a 403 NextResponse when role lacks permission', () => {
    const result = requirePermission('viewer', 'invoices:manage');
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(403);
  });
});
