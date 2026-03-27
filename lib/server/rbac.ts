import { NextResponse } from 'next/server';
import type { MemberRole } from '@/lib/server/auth-context';

export type Permission =
  | 'invoices:read'
  | 'invoices:manage'
  | 'findings:read'
  | 'disputes:create'
  | 'disputes:send'
  | 'documents:upload'
  | 'carriers:manage'
  | 'mailboxes:manage'
  | 'team:manage'
  | 'org:settings';

const PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  owner: new Set([
    'invoices:read',
    'invoices:manage',
    'findings:read',
    'disputes:create',
    'disputes:send',
    'documents:upload',
    'carriers:manage',
    'mailboxes:manage',
    'team:manage',
    'org:settings',
  ]),
  admin: new Set([
    'invoices:read',
    'invoices:manage',
    'findings:read',
    'disputes:create',
    'disputes:send',
    'documents:upload',
    'carriers:manage',
    'mailboxes:manage',
    'team:manage',
  ]),
  manager: new Set([
    'invoices:read',
    'invoices:manage',
    'findings:read',
    'disputes:create',
    'disputes:send',
    'documents:upload',
  ]),
  member: new Set([
    'invoices:read',
    'invoices:manage',
    'findings:read',
    'disputes:create',
    'disputes:send',
    'documents:upload',
  ]),
  viewer: new Set(['invoices:read', 'findings:read']),
} as const;

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return PERMISSIONS[role].has(permission);
}

export function requirePermission(
  role: MemberRole,
  permission: Permission
): NextResponse | null {
  if (hasPermission(role, permission)) {
    return null;
  }
  return NextResponse.json(
    { error: 'Forbidden', required: permission },
    { status: 403 }
  );
}
