# Supporting Pages (Carriers, Settings, Onboarding, Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Carriers page, Settings pages (Team/Mailboxes/Org tabs), 5-step Onboarding wizard, and in-app Notification bell for the Sifter MVP.

**Architecture:** All pages live under `app/(protected)/` using Next.js App Router; server components fetch initial data via Supabase server client while client components handle interactivity through TanStack Query v5 hooks hitting Next.js API routes. RBAC is enforced server-side in every API route using `getAuthOrgContext` + a `hasPermission(role, permission)` helper, and the Notifications system uses a 30-second polling interval rather than WebSockets to stay simple for MVP.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (Postgres + Auth), TanStack Query v5, Tailwind CSS 4, Radix UI, Lucide React, @google-cloud/storage, pnpm

---

## Prerequisites

### Task 0: Schema migration — add `onboarding_completed` to `organizations` and create `notifications` table

**UI wiring:** The `notifications` table is consumed by **`Task 8` (`NotificationBell` in `Navbar`)** — do not leave the table API-only.

**Files:**
- Create: `supabase/migrations/20260326000000_notifications_and_onboarding.sql`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/migrations/notifications-schema.test.ts
import { createClient } from '@/lib/supabase/server';

describe('notifications table', () => {
  it('notifications table exists with correct columns', async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, org_id, user_id, type, title, body, invoice_id, read, created_at')
      .limit(0);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('organizations has onboarding_completed column', async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('organizations')
      .select('onboarding_completed')
      .limit(0);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/migrations/notifications-schema.test.ts`
Expected: FAIL with "column notifications.id does not exist" or relation not found

- [ ] **Step 3: Write minimal implementation**

```sql
-- supabase/migrations/20260326000000_notifications_and_onboarding.sql

-- Add onboarding_completed to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false NOT NULL;

-- Notifications table (in-app only for MVP)
CREATE TABLE public.notifications (
  id          uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       varchar(255) NOT NULL,
  body        text NOT NULL,
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  read        boolean DEFAULT false NOT NULL,
  created_at  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY['carrier_replied','invoice_ready','dispute_resolved'])
  )
);

CREATE INDEX idx_notifications_user_unread
  ON public.notifications (user_id, read, created_at DESC)
  WHERE read = false;

CREATE INDEX idx_notifications_org_user
  ON public.notifications (org_id, user_id, created_at DESC);

-- Rate sheets: current vs superseded (avoids `as never` casts in API code)
ALTER TABLE public.rate_sheets
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'current' NOT NULL;
ALTER TABLE public.rate_sheets DROP CONSTRAINT IF EXISTS rate_sheets_status_check;
ALTER TABLE public.rate_sheets
  ADD CONSTRAINT rate_sheets_status_check CHECK (status = ANY (ARRAY['current','superseded']));
CREATE INDEX IF NOT EXISTS idx_rate_sheets_carrier_status
  ON public.rate_sheets (carrier_id, org_id, status);
```

- [ ] **Step 4: Run migration and verify test passes**
Run: `supabase db push && pnpm test tests/migrations/notifications-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add supabase/migrations/20260326000000_notifications_and_onboarding.sql tests/migrations/notifications-schema.test.ts && git commit -m "feat: add notifications table and organizations.onboarding_completed migration"`

---

### Task 0b: RBAC permission helper

**Files:**
- Create: `lib/server/permissions.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/permissions.test.ts
import { hasPermission, PERMISSIONS } from '@/lib/server/permissions';

describe('hasPermission', () => {
  it('owner can manage_carriers', () => {
    expect(hasPermission('owner', 'manage_carriers')).toBe(true);
  });
  it('member cannot manage_carriers', () => {
    expect(hasPermission('member', 'manage_carriers')).toBe(false);
  });
  it('viewer cannot manage_team', () => {
    expect(hasPermission('viewer', 'manage_team')).toBe(false);
  });
  it('only owner can org_settings', () => {
    expect(hasPermission('owner', 'org_settings')).toBe(true);
    expect(hasPermission('admin', 'org_settings')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/lib/permissions.test.ts`
Expected: FAIL with "Cannot find module '@/lib/server/permissions'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/server/permissions.ts

export const PERMISSIONS = {
  manage_carriers:  ['owner', 'admin'],
  manage_mailboxes: ['owner', 'admin'],
  manage_team:      ['owner', 'admin'],
  org_settings:     ['owner'],
} as const;

export type Permission = keyof typeof PERMISSIONS;
export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export function hasPermission(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/**
 * Resolves the caller's role within an org and checks permission.
 * Returns null if the user is not a member of the org.
 */
export async function assertPermission(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
  userId: string,
  permission: Permission
): Promise<{ allowed: true; role: Role } | { allowed: false; role: null }> {
  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) return { allowed: false, role: null };
  const role = membership.role as Role;
  return hasPermission(role, permission)
    ? { allowed: true, role }
    : { allowed: false, role: null };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/lib/permissions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add lib/server/permissions.ts tests/lib/permissions.test.ts && git commit -m "feat: add RBAC permission helper"`

---

## Task 1: Carriers page — list with expandable cards

**Files:**
- Create: `app/(protected)/carriers/page.tsx`
- Create: `app/components/carriers/CarrierCard.tsx`
- Create: `app/api/carriers/route.ts`
- Create: `app/api/carriers/[id]/route.ts`
- Modify: `app/components/Navbar.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/carriers.test.ts
import { GET, PATCH } from '@/app/api/carriers/[id]/route';
import { NextRequest } from 'next/server';

describe('GET /api/carriers', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/carriers');
    const { GET: listGET } = await import('@/app/api/carriers/route');
    const res = await listGET(req);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/carriers/:id', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/carriers/test-id', {
      method: 'PATCH',
      body: JSON.stringify({ billing_email: 'test@example.com' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'test-id' }) });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/carriers.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/carriers/route'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/carriers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: carriers, error } = await supabase
    .from('carriers')
    .select(`
      id, name_normalized, scac, billing_email, billing_email_confirmed, created_at,
      rate_sheets ( id, document_id, effective_date, uploaded_at,
        documents ( filename )
      )
    `)
    .eq('org_id', ctx.orgId)
    .order('name_normalized', { ascending: true });

  if (error) {
    console.error('GET /api/carriers error:', error);
    return NextResponse.json({ error: 'Failed to fetch carriers' }, { status: 500 });
  }

  // Attach invoice counts
  const carrierIds = (carriers ?? []).map((c) => c.id);
  let invoiceCounts: Record<string, number> = {};
  if (carrierIds.length > 0) {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('carrier_id')
      .eq('org_id', ctx.orgId)
      .in('carrier_id', carrierIds);
    if (invoices) {
      invoiceCounts = invoices.reduce((acc, inv) => {
        acc[inv.carrier_id] = (acc[inv.carrier_id] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }
  }

  const formatted = (carriers ?? []).map((c) => {
    const sheets = (c.rate_sheets as Array<{
      id: string; document_id: string; effective_date: string | null;
      uploaded_at: string; documents: { filename: string } | null;
    }> ?? []).sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
    return {
      id: c.id,
      name: c.name_normalized,
      scac: c.scac ?? null,
      billing_email: c.billing_email ?? null,
      billing_email_confirmed: c.billing_email_confirmed,
      invoice_count: invoiceCounts[c.id] ?? 0,
      rate_sheets: sheets.map((s, idx) => ({
        id: s.id,
        filename: (s.documents as { filename: string } | null)?.filename ?? 'rate-sheet.pdf',
        effective_date: s.effective_date,
        status: idx === 0 ? 'current' : 'superseded',
      })),
    };
  });

  return NextResponse.json({ carriers: formatted }, { headers: NO_CACHE });
}
```

```typescript
// app/api/carriers/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_carriers');
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { billing_email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.billing_email === 'string') {
    updates.billing_email = body.billing_email.trim();
    updates.billing_email_confirmed = false; // reset confirmation on change
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('carriers')
    .update(updates)
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .select('id, billing_email, billing_email_confirmed')
    .maybeSingle();

  if (error) {
    console.error('PATCH /api/carriers/:id error:', error);
    return NextResponse.json({ error: 'Failed to update carrier' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ carrier: data }, { headers: NO_CACHE });
}
```

```typescript
// app/components/carriers/CarrierCard.tsx
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

export interface RateSheet {
  id: string;
  filename: string;
  effective_date: string | null;
  status: 'current' | 'superseded';
}

export interface Carrier {
  id: string;
  name: string;
  scac: string | null;
  billing_email: string | null;
  billing_email_confirmed: boolean;
  invoice_count: number;
  rate_sheets: RateSheet[];
}

interface CarrierCardProps {
  carrier: Carrier;
  canManage: boolean;
}

export function CarrierCard({ carrier, canManage }: CarrierCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [billingEmail, setBillingEmail] = useState(carrier.billing_email ?? '');
  const [dragOver, setDragOver] = useState(false);
  const queryClient = useQueryClient();

  const updateEmail = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/carriers/${carrier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_email: email }),
      });
      if (!res.ok) throw new Error('Failed to update email');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['carriers'] }),
  });

  const uploadRateSheet = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/carriers/${carrier.id}/rate-sheets`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['carriers'] }),
  });

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      uploadRateSheet.mutate(file);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadRateSheet.mutate(file);
  }

  const hasCurrentSheet = carrier.rate_sheets.some((s) => s.status === 'current');

  return (
    <div className="border border-brand-border rounded-lg bg-brand-surface overflow-hidden">
      {/* Collapsed row — click anywhere to toggle */}
      <button
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-brand-surface-muted transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Carrier icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-primary/10 flex items-center justify-center text-brand-primary font-semibold text-sm uppercase">
          {carrier.name.charAt(0)}
        </div>

        {/* Name + SCAC */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-brand-primary truncate block">{carrier.name}</span>
          {carrier.scac && (
            <span className="text-xs text-brand-muted">{carrier.scac}</span>
          )}
        </div>

        {/* Invoice count */}
        <div className="text-sm text-brand-muted w-20 text-right hidden sm:block">
          {carrier.invoice_count} invoice{carrier.invoice_count !== 1 ? 's' : ''}
        </div>

        {/* Billing email + confirmed badge */}
        <div className="flex items-center gap-1.5 w-56 text-sm hidden md:flex">
          {carrier.billing_email ? (
            <>
              <span className="truncate text-brand-primary">{carrier.billing_email}</span>
              {carrier.billing_email_confirmed ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0" />
              )}
            </>
          ) : (
            <span className="text-brand-muted italic">No email</span>
          )}
        </div>

        {/* Rate sheet status */}
        <div className="w-24 text-right hidden sm:block">
          <span
            className={cn(
              'inline-block px-2 py-0.5 rounded text-xs font-medium',
              hasCurrentSheet
                ? 'bg-green-100 text-green-700'
                : 'bg-orange-100 text-orange-700'
            )}
          >
            {hasCurrentSheet ? 'Current' : 'Missing'}
          </span>
        </div>

        {/* Chevron */}
        <div className="flex-shrink-0 text-brand-muted ml-2">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded view */}
      {expanded && (
        <div className="border-t border-brand-border px-4 py-4 space-y-5 bg-brand-surface-muted/30">
          {/* Billing email editor */}
          {canManage && (
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                Billing Email
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@carrier.com"
                  className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
                />
                <button
                  onClick={() => updateEmail.mutate(billingEmail)}
                  disabled={updateEmail.isPending || billingEmail === carrier.billing_email}
                  className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
                >
                  {updateEmail.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
              {updateEmail.isError && (
                <p className="text-xs text-red-600 mt-1">Failed to save email.</p>
              )}
            </div>
          )}

          {/* Rate sheet history */}
          <div>
            <p className="text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
              Rate Sheets
            </p>
            {carrier.rate_sheets.length === 0 ? (
              <p className="text-sm text-brand-muted italic">No rate sheets uploaded.</p>
            ) : (
              <ul className="space-y-1">
                {carrier.rate_sheets.map((sheet) => (
                  <li key={sheet.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        'inline-block px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0',
                        sheet.status === 'current'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      {sheet.status === 'current' ? 'Current' : 'Superseded'}
                    </span>
                    <span className="truncate text-brand-primary">{sheet.filename}</span>
                    {sheet.effective_date && (
                      <span className="text-brand-muted flex-shrink-0">
                        eff. {sheet.effective_date}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Upload drop zone */}
          {canManage && (
            <div>
              <p className="text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
                Upload Rate Sheet
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                  dragOver
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-brand-border hover:border-brand-primary/50'
                )}
              >
                <Upload className="w-6 h-6 mx-auto text-brand-muted mb-2" />
                <p className="text-sm text-brand-muted">
                  Drag &amp; drop a PDF rate sheet here, or{' '}
                  <label className="text-brand-primary cursor-pointer underline">
                    browse
                    <input
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      onChange={handleFileInput}
                    />
                  </label>
                </p>
                {uploadRateSheet.isPending && (
                  <p className="text-xs text-brand-muted mt-2">Uploading…</p>
                )}
                {uploadRateSheet.isError && (
                  <p className="text-xs text-red-600 mt-2">Upload failed. Please try again.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

```typescript
// app/(protected)/carriers/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { redirect } from 'next/navigation';
import CarriersClient from './CarriersClient';

export default async function CarriersPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .eq('status', 'active')
    .maybeSingle();

  const role = membership?.role ?? 'viewer';
  const canManage = ['owner', 'admin'].includes(role);

  return <CarriersClient canManage={canManage} />;
}
```

```typescript
// app/(protected)/carriers/CarriersClient.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { CarrierCard } from '@/app/components/carriers/CarrierCard';
import type { Carrier } from '@/app/components/carriers/CarrierCard';

interface Props {
  canManage: boolean;
}

export default function CarriersClient({ canManage }: Props) {
  const { data, isLoading, isError } = useQuery<{ carriers: Carrier[] }>({
    queryKey: ['carriers'],
    queryFn: async () => {
      const res = await fetch('/api/carriers');
      if (!res.ok) throw new Error('Failed to fetch carriers');
      return res.json();
    },
  });

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-primary">Carriers</h1>
        <p className="text-sm text-brand-muted mt-1">
          Carriers are auto-detected from your invoices. To merge or rename, contact support.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-brand-surface-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600">Failed to load carriers. Please refresh.</p>
      )}

      {data?.carriers && data.carriers.length === 0 && (
        <div className="text-center py-16 text-brand-muted">
          <p className="text-lg font-medium">No carriers yet</p>
          <p className="text-sm mt-1">Carriers will appear here once invoices are processed.</p>
        </div>
      )}

      {data?.carriers && data.carriers.length > 0 && (
        <div className="space-y-2">
          {data.carriers.map((carrier) => (
            <CarrierCard key={carrier.id} carrier={carrier} canManage={canManage} />
          ))}
        </div>
      )}
    </main>
  );
}
```

Now add "Carriers" to the navbar navigation array:

```diff
// app/components/Navbar.tsx  (modify only the navigation array)
const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Invoices', href: '/invoices' },
  { name: 'Findings', href: '/findings' },
+ { name: 'Carriers', href: '/carriers' },
  { name: 'Reports', href: '/reports' },
  { name: 'Settings', href: '/settings' },
];
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/carriers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/(protected)/carriers/ app/components/carriers/ app/api/carriers/route.ts app/api/carriers/[id]/route.ts app/components/Navbar.tsx && git commit -m "feat: carriers page with expandable cards and billing email editor"`

### Task 1b: Billing email confirmation gate (spec §11)

Dispute send must not use an unconfirmed carrier billing address. Implement one of:

- **MVP:** `PATCH /api/carriers/[id]` allows `{ billing_email_confirmed: true }` only when the same user submits a confirmation modal that re-enters the current `billing_email` (or a dedicated `POST /api/carriers/[id]/confirm-billing-email` with empty body for admins).

**Cross-plan:** Document in **Dispute Workflow** `POST /api/disputes/:id/send`: if resolved recipient equals `carriers.billing_email` and `billing_email_confirmed` is false, return **409** `{ error: 'BILLING_EMAIL_UNCONFIRMED', carrier_id }`.

---

## Task 2: Rate sheet upload API

**Files:**
- Create: `app/api/carriers/[id]/rate-sheets/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/rate-sheets-upload.test.ts
import { POST } from '@/app/api/carriers/[id]/rate-sheets/route';
import { NextRequest } from 'next/server';

describe('POST /api/carriers/:id/rate-sheets', () => {
  it('returns 401 when unauthenticated', async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'test.pdf');
    const req = new NextRequest('http://localhost/api/carriers/test-id/rate-sheets', {
      method: 'POST',
      body: form,
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'test-id' }) });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/rate-sheets-upload.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/carriers/[id]/rate-sheets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';

const storage = new Storage();
const BUCKET = process.env.GCS_BUCKET_NAME!;
const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: carrierId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_carriers');
  if (!perm.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify carrier belongs to org
  const { data: carrier } = await supabase
    .from('carriers')
    .select('id')
    .eq('id', carrierId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!carrier) return NextResponse.json({ error: 'Carrier not found' }, { status: 404 });

  // Parse multipart form
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 });
  }

  const fileId = randomUUID();
  const gcsKey = `orgs/${ctx.orgId}/rate-sheets/${carrierId}/${fileId}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload to GCS
  try {
    await storage.bucket(BUCKET).file(gcsKey).save(buffer, {
      metadata: { contentType: 'application/pdf' },
    });
  } catch (err) {
    console.error('GCS upload error:', err);
    return NextResponse.json({ error: 'Upload to storage failed' }, { status: 500 });
  }

  // Create document record
  const { data: document, error: docError } = await supabase
    .from('documents')
    .insert({
      org_id: ctx.orgId,
      source_type: 'upload',
      filename: file.name,
      mime_type: 'application/pdf',
      file_size_bytes: file.size,
      gcs_key: gcsKey,
      sha256: '', // not computed for simplicity; can add later
      document_type: 'OTHER',
      processing_status: 'completed',
    })
    .select('id')
    .single();

  if (docError || !document) {
    console.error('Document insert error:', docError);
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  // Mark previous current rate sheets as superseded
  await supabase
    .from('rate_sheets')
    .update({ status: 'superseded' })
    .eq('carrier_id', carrierId)
    .eq('org_id', ctx.orgId)
    .eq('status', 'current');

  // Insert new rate sheet
  const { data: rateSheet, error: rsError } = await supabase
    .from('rate_sheets')
    .insert({
      org_id: ctx.orgId,
      carrier_id: carrierId,
      document_id: document.id,
      effective_date: null,
      status: 'current',
    })
    .select('id')
    .single();

  if (rsError || !rateSheet) {
    console.error('Rate sheet insert error:', rsError);
    return NextResponse.json({ error: 'Failed to create rate sheet record' }, { status: 500 });
  }

  return NextResponse.json({ rate_sheet_id: rateSheet.id }, { status: 201, headers: NO_CACHE });
}
```

**Note:** `Task 0` migration adds `rate_sheets.status` (`current` | `superseded`). API code uses typed updates—no `as never` casts.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/rate-sheets-upload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/api/carriers/[id]/rate-sheets/route.ts tests/api/rate-sheets-upload.test.ts && git commit -m "feat: rate sheet PDF upload API with GCS storage"`

---

## Task 3: Settings page — Team tab

**Files:**
- Create: `app/(protected)/settings/page.tsx`
- Create: `app/(protected)/settings/SettingsClient.tsx`
- Create: `app/components/settings/TeamTab.tsx`
- Create: `app/api/team/route.ts`
- Create: `app/api/team/[userId]/route.ts`
- Create: `app/api/team/invites/[inviteId]/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/team.test.ts
import { GET, POST } from '@/app/api/team/route';
import { NextRequest } from 'next/server';

describe('GET /api/team', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/team');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/team (invite)', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/team', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', role: 'member' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/team.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/team/route'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/team/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: members, error } = await supabase
    .from('memberships')
    .select(`
      id, role, status, created_at, invited_by,
      users ( id, email, full_name, avatar_url )
    `)
    .eq('org_id', ctx.orgId)
    .in('status', ['active', 'invited'])
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/team error:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }

  return NextResponse.json({ members: members ?? [] }, { headers: NO_CACHE });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_team');
  if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { email?: string; role?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  const role = body.role;
  if (!email || !role || !['admin', 'member', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Valid email and role (admin|member|viewer) are required' }, { status: 400 });
  }

  // Find or create user by email
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  // If user not found, we still create a placeholder membership with 'invited' status
  // Real invite emails are sent via Supabase Auth invites (post-MVP)
  const userId = existingUser?.id;
  if (!userId) {
    return NextResponse.json(
      { error: 'User not found. Invite emails are not yet supported; user must sign up first.' },
      { status: 422 }
    );
  }

  // Check not already a member
  const { data: existing } = await supabase
    .from('memberships')
    .select('id, status')
    .eq('org_id', ctx.orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing && existing.status === 'active') {
    return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
  }

  const { data: membership, error: insertError } = await supabase
    .from('memberships')
    .upsert({
      org_id: ctx.orgId,
      user_id: userId,
      role,
      status: 'invited',
      invited_by: ctx.userId,
    })
    .select('id')
    .single();

  if (insertError || !membership) {
    console.error('POST /api/team insert error:', insertError);
    return NextResponse.json({ error: 'Failed to invite user' }, { status: 500 });
  }

  return NextResponse.json({ membership_id: membership.id }, { status: 201, headers: NO_CACHE });
}
```

```typescript
// app/api/team/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_team');
  if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { role?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const role = body.role;
  if (!role || !['admin', 'member', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Valid role required' }, { status: 400 });
  }

  // Cannot downgrade owner
  const { data: target } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot change owner role' }, { status: 422 });
  }

  const { error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId);

  if (error) return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: NO_CACHE });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: targetUserId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_team');
  if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (targetUserId === ctx.userId) {
    return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 422 });
  }

  const { data: target } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove owner' }, { status: 422 });
  }

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'inactive' })
    .eq('org_id', ctx.orgId)
    .eq('user_id', targetUserId);

  if (error) return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

```typescript
// app/api/team/invites/[inviteId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const { inviteId } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_team');
  if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('memberships')
    .update({ status: 'inactive' })
    .eq('id', inviteId)
    .eq('org_id', ctx.orgId)
    .eq('status', 'invited');

  if (error) return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

```typescript
// app/components/settings/TeamTab.tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useAuth } from '@/app/components/AuthProvider';

type Role = 'owner' | 'admin' | 'member' | 'viewer';
type MemberStatus = 'active' | 'invited';

interface Member {
  id: string;
  role: Role;
  status: MemberStatus;
  users: { id: string; email: string; full_name: string | null; avatar_url: string | null };
}

function roleBadgeClass(role: Role) {
  const map: Record<Role, string> = {
    owner: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    member: 'bg-gray-100 text-gray-700',
    viewer: 'bg-gray-100 text-gray-500',
  };
  return map[role];
}

function Initials({ name, email }: { name: string | null; email: string }) {
  const label = name ?? email;
  const initials = label.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center text-xs font-semibold text-brand-primary flex-shrink-0">
      {initials}
    </div>
  );
}

interface TeamTabProps {
  canManage: boolean;
  currentUserId: string;
}

export function TeamTab({ canManage, currentUserId }: TeamTabProps) {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ members: Member[] }>({
    queryKey: ['team'],
    queryFn: async () => {
      const res = await fetch('/api/team');
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/team/${userId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove member');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await fetch(`/api/team/invites/${inviteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke invite');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to invite');
      return json;
    },
    onSuccess: () => {
      setInviteEmail('');
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err: Error) => setInviteError(err.message),
  });

  const active = data?.members.filter((m) => m.status === 'active') ?? [];
  const invited = data?.members.filter((m) => m.status === 'invited') ?? [];

  return (
    <div className="space-y-8">
      {/* Active members */}
      <section>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
          Team Members
        </h3>
        {isLoading && <p className="text-sm text-brand-muted">Loading…</p>}
        <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
          {active.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
              <Initials name={m.users.full_name} email={m.users.email} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-primary truncate">
                  {m.users.full_name ?? m.users.email}
                </p>
                <p className="text-xs text-brand-muted truncate">{m.users.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${roleBadgeClass(m.role)}`}>
                {m.role}
              </span>
              {canManage && m.role !== 'owner' && m.users.id !== currentUserId && (
                <button
                  onClick={() => removeMember.mutate(m.users.id)}
                  disabled={removeMember.isPending}
                  className="text-brand-muted hover:text-red-500 transition-colors"
                  aria-label={`Remove ${m.users.email}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invites */}
      {invited.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
            Pending Invites
          </h3>
          <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
            {invited.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
                <Initials name={m.users.full_name} email={m.users.email} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-brand-primary truncate">{m.users.email}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-100 text-yellow-700">
                  Invited
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${roleBadgeClass(m.role)}`}>
                  {m.role}
                </span>
                {canManage && (
                  <button
                    onClick={() => revokeInvite.mutate(m.id)}
                    disabled={revokeInvite.isPending}
                    className="text-xs text-brand-muted hover:text-red-500 transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Invite form */}
      {canManage && (
        <section>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
            Invite a Team Member
          </h3>
          <div className="flex gap-2 flex-wrap">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 min-w-48 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              onClick={() => sendInvite.mutate()}
              disabled={sendInvite.isPending || !inviteEmail}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {sendInvite.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-600 mt-2">{inviteError}</p>}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/team.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/api/team/ app/components/settings/TeamTab.tsx && git commit -m "feat: team management API routes and TeamTab component"`

---

## Task 4: Settings page — Mailboxes tab

**Files:**
- Create: `app/components/settings/MailboxesTab.tsx`
- Create: `app/api/mailboxes/route.ts`
- Create: `app/api/mailboxes/[id]/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/mailboxes.test.ts
import { GET } from '@/app/api/mailboxes/route';
import { NextRequest } from 'next/server';

describe('GET /api/mailboxes', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/mailboxes');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/mailboxes.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/mailboxes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: connections, error } = await supabase
    .from('email_connections')
    .select('id, provider, email, status, last_sync_at, last_error, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/mailboxes error:', error);
    return NextResponse.json({ error: 'Failed to fetch mailboxes' }, { status: 500 });
  }

  return NextResponse.json({ mailboxes: connections ?? [] }, { headers: NO_CACHE });
}
```

```typescript
// app/api/mailboxes/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'manage_mailboxes');
  if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase
    .from('email_connections')
    .update({ status: 'disconnected' })
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) return NextResponse.json({ error: 'Failed to disconnect mailbox' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

```typescript
// app/components/settings/MailboxesTab.tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, AlertCircle, CheckCircle, MinusCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Mailbox {
  id: string;
  provider: 'gmail' | 'outlook';
  email: string;
  status: 'active' | 'disconnected' | 'error';
  last_sync_at: string | null;
  last_error: string | null;
}

function StatusDot({ status }: { status: Mailbox['status'] }) {
  if (status === 'active') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <MinusCircle className="w-4 h-4 text-gray-400" />;
}

interface MailboxesTabProps {
  canManage: boolean;
}

export function MailboxesTab({ canManage }: MailboxesTabProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ mailboxes: Mailbox[] }>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      const res = await fetch('/api/mailboxes');
      if (!res.ok) throw new Error('Failed to fetch mailboxes');
      return res.json();
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/mailboxes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailboxes'] }),
  });

  const mailboxes = data?.mailboxes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
          Connected Accounts
        </h3>

        {isLoading && <p className="text-sm text-brand-muted">Loading…</p>}

        {!isLoading && mailboxes.length === 0 && (
          <p className="text-sm text-brand-muted italic">No mailboxes connected.</p>
        )}

        {mailboxes.length > 0 && (
          <ul className="divide-y divide-brand-border border border-brand-border rounded-lg overflow-hidden">
            {mailboxes.map((mb) => (
              <li key={mb.id} className="flex items-center gap-3 px-4 py-3 bg-brand-surface">
                <Mail className="w-5 h-5 text-brand-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-primary truncate">{mb.email}</p>
                  <p className="text-xs text-brand-muted capitalize">
                    {mb.provider}
                    {mb.last_sync_at
                      ? ` · synced ${formatDistanceToNow(new Date(mb.last_sync_at), { addSuffix: true })}`
                      : ' · never synced'}
                  </p>
                  {mb.status === 'error' && mb.last_error && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">{mb.last_error}</p>
                  )}
                </div>
                <StatusDot status={mb.status} />
                {canManage && (
                  <button
                    onClick={() => disconnect.mutate(mb.id)}
                    disabled={disconnect.isPending}
                    className="text-xs text-brand-muted hover:text-red-500 transition-colors ml-2"
                  >
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="flex gap-3">
          <a
            href="/api/oauth/gmail/connect"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Gmail
          </a>
          <a
            href="/api/oauth/outlook/connect"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Outlook
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/mailboxes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/api/mailboxes/ app/components/settings/MailboxesTab.tsx && git commit -m "feat: mailboxes API routes and MailboxesTab component"`

---

## Task 5: Settings page — Organization tab + Settings shell

**Files:**
- Create: `app/components/settings/OrganizationTab.tsx`
- Create: `app/api/org/route.ts`
- Create: `app/(protected)/settings/page.tsx`
- Create: `app/(protected)/settings/SettingsClient.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/org.test.ts
import { PATCH } from '@/app/api/org/route';
import { NextRequest } from 'next/server';

describe('PATCH /api/org', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/org', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/org.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/org/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { assertPermission } from '@/lib/server/permissions';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug, timezone, onboarding_completed')
    .eq('id', ctx.orgId)
    .maybeSingle();

  if (error || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  return NextResponse.json({ org }, { headers: NO_CACHE });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; timezone?: string; onboarding_completed?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // org_settings required for name/timezone changes
  if (body.name !== undefined || body.timezone !== undefined) {
    const perm = await assertPermission(supabase, ctx.orgId, ctx.userId, 'org_settings');
    if (!perm.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.timezone === 'string') updates.timezone = body.timezone.trim();
  }

  // onboarding_completed can be set by any active member
  if (body.onboarding_completed === true) {
    updates.onboarding_completed = true;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', ctx.orgId)
    .select('id, name, timezone, onboarding_completed')
    .maybeSingle();

  if (error || !data) {
    console.error('PATCH /api/org error:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }

  return NextResponse.json({ org: data }, { headers: NO_CACHE });
}
```

```typescript
// app/components/settings/OrganizationTab.tsx
'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

// IANA timezone list (abbreviated; full list available via Intl API)
const TIMEZONES = Intl.supportedValuesOf('timeZone');

interface OrganizationTabProps {
  initialName: string;
  initialTimezone: string;
  isOwner: boolean;
}

export function OrganizationTab({ initialName, initialTimezone, isOwner }: OrganizationTabProps) {
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone || 'UTC');
  const [saved, setSaved] = useState(false);

  const updateOrg = useMutation({
    mutationFn: async (updates: { name?: string; timezone?: string }) => {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update organization');
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-brand-primary mb-1.5">
          Organization Name
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
          />
          {isOwner && (
            <button
              onClick={() => updateOrg.mutate({ name })}
              disabled={updateOrg.isPending || name === initialName}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-brand-primary mb-1.5">
          Timezone
        </label>
        <div className="flex gap-2">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!isOwner}
            className="flex-1 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          {isOwner && (
            <button
              onClick={() => updateOrg.mutate({ timezone })}
              disabled={updateOrg.isPending || timezone === initialTimezone}
              className="px-4 py-2 rounded-md bg-brand-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
            >
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {saved && <p className="text-sm text-green-600">Changes saved.</p>}
      {updateOrg.isError && <p className="text-sm text-red-600">Failed to save changes.</p>}

      {!isOwner && (
        <p className="text-xs text-brand-muted italic">
          Only the organization owner can edit these settings.
        </p>
      )}
    </div>
  );
}
```

```typescript
// app/(protected)/settings/SettingsClient.tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { TeamTab } from '@/app/components/settings/TeamTab';
import { MailboxesTab } from '@/app/components/settings/MailboxesTab';
import { OrganizationTab } from '@/app/components/settings/OrganizationTab';

type Tab = 'team' | 'mailboxes' | 'organization';

interface Props {
  orgId: string;
  orgName: string;
  orgTimezone: string;
  currentUserId: string;
  role: string;
}

export default function SettingsClient({ orgName, orgTimezone, currentUserId, role }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('team');
  const canManageTeam = ['owner', 'admin'].includes(role);
  const canManageMailboxes = ['owner', 'admin'].includes(role);
  const isOwner = role === 'owner';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'team', label: 'Team' },
    { id: 'mailboxes', label: 'Mailboxes' },
    { id: 'organization', label: 'Organization' },
  ];

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold text-brand-primary mb-6">Settings</h1>

      {/* Tab bar */}
      <div className="border-b border-brand-border mb-6">
        <nav className="flex -mb-px space-x-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-brand-muted hover:text-brand-primary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'team' && (
        <TeamTab canManage={canManageTeam} currentUserId={currentUserId} />
      )}
      {activeTab === 'mailboxes' && (
        <MailboxesTab canManage={canManageMailboxes} />
      )}
      {activeTab === 'organization' && (
        <OrganizationTab
          initialName={orgName}
          initialTimezone={orgTimezone}
          isOwner={isOwner}
        />
      )}
    </main>
  );
}
```

```typescript
// app/(protected)/settings/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { redirect } from 'next/navigation';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const [{ data: membership }, { data: org }] = await Promise.all([
    supabase
      .from('memberships')
      .select('role')
      .eq('org_id', ctx.orgId)
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('id, name, timezone')
      .eq('id', ctx.orgId)
      .maybeSingle(),
  ]);

  if (!org) redirect('/dashboard');

  return (
    <SettingsClient
      orgId={ctx.orgId}
      orgName={org.name}
      orgTimezone={org.timezone ?? 'UTC'}
      currentUserId={ctx.userId}
      role={membership?.role ?? 'viewer'}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/org.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/api/org/ app/components/settings/ app/(protected)/settings/ && git commit -m "feat: settings page with Team, Mailboxes, and Organization tabs"`

---

## Task 6: Onboarding flow (5-step wizard)

**Files:**
- Create: `app/(protected)/onboarding/page.tsx`
- Create: `app/(protected)/onboarding/OnboardingWizard.tsx`
- Modify: `app/(protected)/layout.tsx` — add onboarding redirect check

- [ ] **Step 1: Write the failing test**

```typescript
// tests/onboarding/wizard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import OnboardingWizard from '@/app/(protected)/onboarding/OnboardingWizard';

// Mock fetch globally
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

describe('OnboardingWizard', () => {
  it('renders step 1 welcome message', () => {
    render(<OnboardingWizard orgName="Acme Logistics" />);
    expect(screen.getByText(/Welcome to Sifter/i)).toBeInTheDocument();
    expect(screen.getByText(/Acme Logistics/i)).toBeInTheDocument();
  });

  it('advances from step 1 to step 2 on Next click', () => {
    render(<OnboardingWizard orgName="Acme Logistics" />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/Connect your mailbox/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/onboarding/wizard.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/(protected)/onboarding/OnboardingWizard.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  orgName: string;
}

type Step = 1 | 2 | 3 | 4 | 5;

interface Mailbox {
  id: string;
  provider: string;
  email: string;
  status: string;
}

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div
          key={s}
          className={cn(
            'w-2 h-2 rounded-full transition-colors',
            s < current && 'bg-brand-primary',
            s === current && 'bg-brand-primary w-4',
            s > current && 'bg-brand-border'
          )}
        />
      ))}
    </div>
  );
}

// Step 1: Welcome
function WelcomeStep({ orgName, onNext }: { orgName: string; onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-brand-primary">
          Welcome to Sifter, {orgName}!
        </h2>
        <p className="text-brand-muted mt-2">
          Let&apos;s get you set up. This will only take a few minutes.
        </p>
      </div>
      <button
        onClick={onNext}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
      >
        Get Started
      </button>
    </div>
  );
}

// Step 2: Connect mailbox
function ConnectMailboxStep({ onNext }: { onNext: () => void }) {
  const { data, isLoading } = useQuery<{ mailboxes: Mailbox[] }>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      const res = await fetch('/api/mailboxes');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    refetchInterval: 5000, // poll to detect OAuth completion
  });

  const connected = (data?.mailboxes ?? []).filter((m) => m.status === 'active');
  const hasConnection = connected.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-primary">Connect your mailbox</h2>
        <p className="text-brand-muted text-sm mt-1">
          Sifter scans your inbox to collect freight invoices automatically. Connect at least one mailbox to continue.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <a
          href="/api/oauth/gmail/connect"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
        >
          Connect Gmail
        </a>
        <a
          href="/api/oauth/outlook/connect"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-brand-border bg-brand-surface text-sm font-medium text-brand-primary hover:bg-brand-surface-muted transition-colors"
        >
          Connect Outlook
        </a>
      </div>

      {isLoading && <p className="text-sm text-brand-muted">Checking connections…</p>}

      {connected.length > 0 && (
        <ul className="space-y-1">
          {connected.map((mb) => (
            <li key={mb.id} className="flex items-center gap-2 text-sm text-brand-primary">
              <CheckCircle className="w-4 h-4 text-green-500" />
              {mb.email}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onNext}
        disabled={!hasConnection}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
      >
        Next
      </button>
    </div>
  );
}

// Step 3 & 4: File upload step (reused for rate sheets and BOLs)
interface UploadStepProps {
  title: string;
  description: string;
  uploadUrl: string;
  accuracyNote: string;
  onNext: () => void;
  onSkip: () => void;
}

function UploadStep({ title, description, uploadUrl, accuracyNote, onNext, onSkip }: UploadStepProps) {
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf') continue;
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(uploadUrl, { method: 'POST', body: form });
        if (res.ok) setUploadedFiles((prev) => [...prev, file.name]);
      } catch {
        // silent — user can retry
      }
    }
    setUploading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-primary">{title}</h2>
        <p className="text-brand-muted text-sm mt-1">{description}</p>
      </div>

      <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-sm text-blue-700">
        {accuracyNote}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={cn(
          'border-2 border-dashed rounded-lg p-10 text-center transition-colors',
          dragOver ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-border'
        )}
      >
        <Upload className="w-8 h-8 mx-auto text-brand-muted mb-3" />
        <p className="text-sm text-brand-muted">
          Drag &amp; drop PDFs here, or{' '}
          <label className="text-brand-primary cursor-pointer underline">
            browse
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        </p>
        {uploading && <Loader2 className="w-5 h-5 mx-auto mt-3 text-brand-muted animate-spin" />}
      </div>

      {uploadedFiles.length > 0 && (
        <ul className="space-y-1">
          {uploadedFiles.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-brand-primary">
              <CheckCircle className="w-4 h-4 text-green-500" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-4 items-center">
        <button
          onClick={onNext}
          className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
        >
          Next
        </button>
        <button onClick={onSkip} className="text-sm text-brand-muted hover:text-brand-primary">
          Skip for now
        </button>
      </div>
    </div>
  );
}

// Step 5: Done
function DoneStep({ onFinish, isFinishing }: { onFinish: () => void; isFinishing: boolean }) {
  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
        <CheckCircle className="w-8 h-8 text-green-600" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-brand-primary">You&apos;re all set!</h2>
        <p className="text-brand-muted mt-2">
          Processing your email backlog…
        </p>
        <Loader2 className="w-5 h-5 mx-auto mt-3 text-brand-muted animate-spin" />
      </div>
      <button
        onClick={onFinish}
        disabled={isFinishing}
        className="px-6 py-2.5 rounded-md bg-brand-primary text-white font-medium disabled:opacity-50 hover:bg-brand-primary/90 transition-colors"
      >
        {isFinishing ? 'Redirecting…' : 'Go to Dashboard'}
      </button>
    </div>
  );
}

export default function OnboardingWizard({ orgName }: Props) {
  const [step, setStep] = useState<Step>(1);
  const router = useRouter();

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_completed: true }),
      });
      if (!res.ok) throw new Error('Failed to complete onboarding');
    },
    onSuccess: () => router.push('/dashboard'),
  });

  return (
    <div className="min-h-screen bg-brand-background flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-brand-surface rounded-xl border border-brand-border p-8 shadow-sm">
        <StepIndicator current={step} total={5} />

        {step === 1 && (
          <WelcomeStep orgName={orgName} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <ConnectMailboxStep onNext={() => setStep(3)} />
        )}
        {step === 3 && (
          <UploadStep
            title="Upload rate sheets"
            description="Rate sheets let Sifter verify the exact rates your carriers agreed to."
            uploadUrl="/api/documents/upload?type=rate_sheet"
            accuracyNote="~60% accuracy without rate sheets. Upload for ~90% accuracy."
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <UploadStep
            title="Upload Bills of Lading (BOLs)"
            description="BOLs help Sifter cross-check shipment details and accessorial charges."
            uploadUrl="/api/documents/upload?type=bol"
            accuracyNote="BOLs allow Sifter to catch detention, accessorial, and BOL mismatch findings."
            onNext={() => setStep(5)}
            onSkip={() => setStep(5)}
          />
        )}
        {step === 5 && (
          <DoneStep
            onFinish={() => completeOnboarding.mutate()}
            isFinishing={completeOnboarding.isPending}
          />
        )}
      </div>
    </div>
  );
}
```

```typescript
// app/(protected)/onboarding/page.tsx
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { redirect } from 'next/navigation';
import OnboardingWizard from './OnboardingWizard';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) redirect('/login');

  const { data: org } = await supabase
    .from('organizations')
    .select('name, onboarding_completed')
    .eq('id', ctx.orgId)
    .maybeSingle();

  if (!org) redirect('/dashboard');
  if (org.onboarding_completed) redirect('/dashboard');

  return <OnboardingWizard orgName={org.name} />;
}
```

Now modify `app/(protected)/layout.tsx` to add the onboarding redirect. Add a check after the org is resolved:

```typescript
// app/(protected)/layout.tsx  — add after orgId is resolved (before return)
// Insert this block before the return statement:

import { headers } from 'next/headers';

// Inside ProtectedLayout, after orgId is confirmed:
const pathname = (await headers()).get('x-pathname') ?? '';
if (orgId && !pathname.startsWith('/onboarding')) {
  const { data: org } = await supabase
    .from('organizations')
    .select('onboarding_completed')
    .eq('id', orgId)
    .maybeSingle();

  if (org && !org.onboarding_completed) {
    redirect('/onboarding');
  }
}
```

**Important:** To expose `x-pathname` to server components, add the following to `middleware.ts` (create if missing):

```typescript
// middleware.ts
import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/onboarding/wizard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/(protected)/onboarding/ middleware.ts && git commit -m "feat: 5-step onboarding wizard with mailbox connect and file uploads"`

---

## Task 7: Notifications API

**Files:**
- Create: `app/api/notifications/route.ts`
- Create: `app/api/notifications/[id]/read/route.ts`
- Create: `app/api/notifications/read-all/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/notifications.test.ts
import { GET } from '@/app/api/notifications/route';
import { NextRequest } from 'next/server';

describe('GET /api/notifications', () => {
  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/notifications?limit=10');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/api/notifications.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') ?? '10', 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 10 : rawLimit, 1), 50);

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, invoice_id, read, created_at')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('GET /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }

  const unread_count = (notifications ?? []).filter((n) => !n.read).length;

  return NextResponse.json(
    { notifications: notifications ?? [], unread_count },
    { headers: NO_CACHE }
  );
}
```

```typescript
// app/api/notifications/[id]/read/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .eq('org_id', ctx.orgId);

  if (error) return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

```typescript
// app/api/notifications/read-all/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getAuthOrgContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .eq('read', false);

  if (error) return NextResponse.json({ error: 'Failed to mark all as read' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/api/notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/api/notifications/ tests/api/notifications.test.ts && git commit -m "feat: notifications API (list, mark read, mark all read)"`

---

## Task 8: Notification bell component (navbar)

**Files:**
- Create: `app/components/Notifications/NotificationBell.tsx`
- Create: `app/components/Notifications/NotificationDropdown.tsx`
- Modify: `app/components/Navbar.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/NotificationBell.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBell } from '@/app/components/Notifications/NotificationBell';

const queryClient = new QueryClient();

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ notifications: [], unread_count: 3 }),
});

describe('NotificationBell', () => {
  it('renders bell icon', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationBell />
      </QueryClientProvider>
    );
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('shows unread badge when count > 0', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationBell />
      </QueryClientProvider>
    );
    // Wait for query to resolve
    const badge = await screen.findByText('3');
    expect(badge).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/components/NotificationBell.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/components/Notifications/NotificationDropdown.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Mail, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export interface Notification {
  id: string;
  type: 'carrier_replied' | 'invoice_ready' | 'dispute_resolved';
  title: string;
  body: string;
  invoice_id: string | null;
  read: boolean;
  created_at: string;
}

function NotificationIcon({ type }: { type: Notification['type'] }) {
  if (type === 'carrier_replied') return <Mail className="w-4 h-4 text-blue-500" />;
  if (type === 'invoice_ready') return <FileText className="w-4 h-4 text-green-500" />;
  return <CheckCircle2 className="w-4 h-4 text-purple-500" />;
}

interface Props {
  notifications: Notification[];
  onClose: () => void;
}

export function NotificationDropdown({ notifications, onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch('/api/notifications/read-all', { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleNotificationClick(n: Notification) {
    if (!n.read) markRead.mutate(n.id);
    if (n.invoice_id) router.push(`/invoices/${n.invoice_id}`);
    onClose();
  }

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="absolute right-0 mt-2 w-80 rounded-xl shadow-lg bg-brand-surface border border-brand-border z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
        <span className="text-sm font-semibold text-brand-primary">Notifications</span>
        {hasUnread && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="text-xs text-brand-muted hover:text-brand-primary transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Bell className="w-8 h-8 mx-auto text-brand-muted mb-2" />
          <p className="text-sm text-brand-muted">No notifications yet</p>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-brand-border">
          {notifications.map((n) => (
            <li
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              className={cn(
                'flex gap-3 px-4 py-3 cursor-pointer hover:bg-brand-surface-muted transition-colors',
                !n.read && 'bg-blue-50/40'
              )}
            >
              <div className="flex-shrink-0 mt-0.5">
                <NotificationIcon type={n.type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', !n.read ? 'font-semibold text-brand-primary' : 'text-brand-primary')}>
                  {n.title}
                </p>
                <p className="text-xs text-brand-muted mt-0.5 truncate">{n.body}</p>
                <p className="text-xs text-brand-muted mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
              {!n.read && (
                <div className="flex-shrink-0 mt-1.5 w-2 h-2 rounded-full bg-blue-500" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```typescript
// app/components/Notifications/NotificationBell.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { NotificationDropdown } from './NotificationDropdown';
import type { Notification } from './NotificationDropdown';

interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=10');
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    refetchInterval: 30000, // 30s polling
    staleTime: 10000,
  });

  const unreadCount = data?.unread_count ?? 0;

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className="relative p-2 rounded-md text-brand-muted hover:text-brand-primary hover:bg-brand-surface-muted transition-colors focus:outline-none focus:ring-2 focus:ring-brand-border-focus"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationDropdown
          notifications={data?.notifications ?? []}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

Now modify `app/components/Navbar.tsx` to add `NotificationBell` into the right-side actions area:

```diff
// app/components/Navbar.tsx
+ import { NotificationBell } from './Notifications/NotificationBell';

// Inside the right-side div (className="flex items-center space-x-4 flex-shrink-0"):
  {user && (
    <>
+     <NotificationBell />
      <div className="relative">
        ...
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/components/NotificationBell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**
`git add app/components/Notifications/ app/components/Navbar.tsx tests/components/NotificationBell.test.tsx && git commit -m "feat: notification bell with unread count badge and dropdown"`

---

## Task 9: Remove "Mailboxes" from top-level navbar (now under Settings)

The existing navbar has `{ name: 'Mailboxes', href: '/mailboxes' }`. Since mailboxes are now managed under Settings → Mailboxes tab, this standalone link should be removed to avoid duplicate navigation.

**Files:**
- Modify: `app/components/Navbar.tsx`

- [ ] **Step 1: (No test needed — pure nav cleanup)**

- [ ] **Step 2: Make the change**

```diff
// app/components/Navbar.tsx — update navigation array
const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Invoices', href: '/invoices' },
  { name: 'Findings', href: '/findings' },
  { name: 'Carriers', href: '/carriers' },
  { name: 'Reports', href: '/reports' },
- { name: 'Mailboxes', href: '/mailboxes' },
  { name: 'Settings', href: '/settings' },
];
```

- [ ] **Step 3: Commit**
`git add app/components/Navbar.tsx && git commit -m "refactor: move Mailboxes to Settings tab, add Carriers nav link"`

---

## Final integration checklist

- [ ] Run `pnpm build` — no TypeScript errors
- [ ] Verify `/carriers` page loads and carrier cards expand/collapse
- [ ] Verify rate sheet PDF upload works end-to-end (GCS + DB)
- [ ] Verify `/settings` team invite and remove flow
- [ ] Verify `/settings` mailbox disconnect
- [ ] Verify `/settings` org name and timezone save (Owner only)
- [ ] Verify new org redirects to `/onboarding` and completes to `/dashboard`
- [ ] Verify notification bell polls every 30s and shows dropdown
- [ ] Run `pnpm test` — all tests pass
- [ ] `git push origin main`
