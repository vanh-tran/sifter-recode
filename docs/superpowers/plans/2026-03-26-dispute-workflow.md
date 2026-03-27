# Dispute Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full dispute workflow for Sifter — from AI letter generation through send, carrier reply ingestion, and resolution — replacing the legacy PDF-based `dispute_documents` approach with the new `disputes` / `dispute_messages` schema.

**Architecture:** All dispute state lives in a single `disputes` row per invoice (UNIQUE on `invoice_id`); every send and inbound reply is appended to `dispute_messages` as immutable history. The UI panels (`DisputeDraftPanel`, `DisputeActivePanel`) render inside the existing Invoice Detail right panel rather than as separate pages, keeping the AP workflow single-screen.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase Postgres (disputes + dispute_messages tables), OpenAI `gpt-4o` for letter generation, Gmail API (`messages.send`) / Microsoft Graph for email sending, Inngest for inbound email event handling, TanStack Query v5, Tailwind CSS 4, Radix UI, Lucide React.

---

## Migration Note

The existing codebase has a legacy `dispute_documents` table and related routes (`POST /api/invoices/:id/disputes/generate`, `POST /api/disputes/:id/send`). The new plan targets the `disputes` + `dispute_messages` schema from schema-v2.sql. Do **not** delete the old routes until the new UI is wired up; feature-flag or route-coexist during transition.

---

### Task 1: Dispute API — CRUD + State Transitions

**Files:**
- Create: `app/api/invoices/[id]/disputes/create/route.ts`
- Modify: `app/api/invoices/[id]/disputes/route.ts` (add GET for single dispute with messages)
- Create: `app/api/disputes/[disputeId]/route.ts` (GET + PATCH)
- Create: `app/api/disputes/[disputeId]/generate-letter/route.ts`
- Create: `app/api/disputes/[disputeId]/send/route.ts`
- Create: `app/api/disputes/[disputeId]/resolve/route.ts`
- Create: `lib/disputes/state-machine.ts`
- Test: `tests/lib/disputes/state-machine.test.ts`

---

- [ ] **Step 1: Write the failing test for state machine guards**

```typescript
// tests/lib/disputes/state-machine.test.ts
import { assertTransition, VALID_TRANSITIONS } from '@/lib/disputes/state-machine';

describe('dispute state machine', () => {
  it('allows draft → sent', () => {
    expect(() => assertTransition('draft', 'sent')).not.toThrow();
  });

  it('allows sent → carrier_replied', () => {
    expect(() => assertTransition('sent', 'carrier_replied')).not.toThrow();
  });

  it('allows carrier_replied → resolved', () => {
    expect(() => assertTransition('carrier_replied', 'resolved')).not.toThrow();
  });

  it('allows sent → resolved (direct resolution without reply)', () => {
    expect(() => assertTransition('sent', 'resolved')).not.toThrow();
  });

  it('blocks draft → resolved', () => {
    expect(() => assertTransition('draft', 'resolved')).toThrow(/Invalid transition/);
  });

  it('blocks resolved → sent', () => {
    expect(() => assertTransition('resolved', 'sent')).toThrow(/Invalid transition/);
  });

  it('blocks any transition from resolved', () => {
    expect(() => assertTransition('resolved', 'draft')).toThrow(/Invalid transition/);
    expect(() => assertTransition('resolved', 'carrier_replied')).toThrow(/Invalid transition/);
  });

  it('allows editing draft_letter only in draft status', () => {
    expect(() => assertTransition('draft', 'draft')).not.toThrow(); // self = update
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/disputes/state-machine.test.ts`
Expected: FAIL with "Cannot find module '@/lib/disputes/state-machine'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/disputes/state-machine.ts

export type DisputeStatus = 'draft' | 'sent' | 'carrier_replied' | 'resolved';

// Each key: from status → allowed next statuses
export const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  draft: ['sent', 'draft'],            // 'draft' self = update allowed
  sent: ['carrier_replied', 'resolved'],
  carrier_replied: ['resolved', 'sent'], // can re-send round 2
  resolved: [],
};

/**
 * Throws if the from→to transition is not in the allowed set.
 * Call this before any status-changing DB write.
 */
export function assertTransition(from: DisputeStatus, to: DisputeStatus): void {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ')}]`
    );
  }
}

/**
 * Returns true if the dispute can be edited (draft_letter, disputed_finding_ids).
 */
export function canEdit(status: DisputeStatus): boolean {
  return status === 'draft';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/disputes/state-machine.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the POST create route**

```typescript
// tests/app/api/invoices/[id]/disputes/create.test.ts
// Integration-style: mock Supabase, test guard and response shape

import { POST } from '@/app/api/invoices/[id]/disputes/create/route';
import { NextRequest } from 'next/server';

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/server/auth-context', () => ({
  getAuthOrgContext: jest.fn(),
}));

const { createClient } = require('@/lib/supabase/server');
const { getAuthOrgContext } = require('@/lib/server/auth-context');

describe('POST /api/invoices/:id/disputes/create', () => {
  beforeEach(() => {
    getAuthOrgContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthOrgContext.mockResolvedValueOnce(null);
    const req = new NextRequest('http://localhost/api/invoices/uuid-1/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: [] }),
    });
    const res = await POST(req, { params: { id: 'uuid-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid invoice UUID', async () => {
    createClient.mockResolvedValue({ from: jest.fn() });
    const req = new NextRequest('http://localhost/api/invoices/not-a-uuid/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: [] }),
    });
    const res = await POST(req, { params: { id: 'not-a-uuid' } });
    expect(res.status).toBe(400);
  });

  it('returns 409 when dispute already exists (UNIQUE violation)', async () => {
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'inv-1' }, error: null }),
          }),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: mockFrom });

    const req = new NextRequest('http://localhost/api/invoices/uuid-inv/disputes/create', {
      method: 'POST',
      body: JSON.stringify({ disputed_finding_ids: ['f-1'] }),
    });
    const res = await POST(req, { params: { id: 'uuid-inv' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/app/api/invoices/[id]/disputes/create.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 7: Write the create route implementation**

```typescript
// app/api/invoices/[id]/disputes/create/route.ts
/**
 * POST /api/invoices/:id/disputes/create
 *
 * Create a draft dispute for an invoice.
 * Enforced: one dispute per invoice (UNIQUE constraint → 409 on duplicate).
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const invoiceId = resolvedParams.id;

    if (!isValidUuid(invoiceId)) {
      return NextResponse.json({ error: 'Invalid invoice ID' }, { status: 400 });
    }

    const body = await request.json();
    const { disputed_finding_ids = [] } = body;

    // Verify invoice belongs to org
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, carrier_id')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Fetch carrier billing email for pre-population
    const { data: carrier } = await supabase
      .from('carriers')
      .select('billing_email, billing_email_confirmed')
      .eq('id', invoice.carrier_id)
      .eq('org_id', orgId)
      .single();

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .insert({
        org_id: orgId,
        invoice_id: invoiceId,
        status: 'draft',
        disputed_finding_ids,
        recipient_email: carrier?.billing_email ?? null,
      })
      .select()
      .single();

    if (disputeError) {
      // Postgres UNIQUE violation
      if (disputeError.code === '23505') {
        return NextResponse.json(
          { error: 'Dispute already exists for this invoice' },
          { status: 409 }
        );
      }
      console.error('Error creating dispute:', disputeError);
      return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
    }

    return NextResponse.json({ dispute }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/invoices/:id/disputes/create:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 8: Write GET + PATCH for /api/disputes/[disputeId]**

```typescript
// app/api/disputes/[disputeId]/route.ts
/**
 * GET  /api/disputes/:disputeId  — fetch dispute with messages
 * PATCH /api/disputes/:disputeId — update draft_letter / disputed_finding_ids (draft only)
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { canEdit, type DisputeStatus } from '@/lib/disputes/state-machine';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> | { disputeId: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.disputeId;

    if (!isValidUuid(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: dispute, error } = await supabase
      .from('disputes')
      .select('*')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (error || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const { data: messages } = await supabase
      .from('dispute_messages')
      .select('*')
      .eq('dispute_id', disputeId)
      .eq('org_id', orgId)
      .order('sent_at', { ascending: true });

    return NextResponse.json({ dispute, messages: messages ?? [] });
  } catch (error) {
    console.error('Error in GET /api/disputes/:disputeId:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> | { disputeId: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.disputeId;

    if (!isValidUuid(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabase
      .from('disputes')
      .select('status')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    if (!canEdit(existing.status as DisputeStatus)) {
      return NextResponse.json(
        { error: `Cannot edit dispute in status: ${existing.status}` },
        { status: 422 }
      );
    }

    const body = await request.json();
    const allowedFields: Record<string, unknown> = {};
    if ('draft_letter' in body) allowedFields.draft_letter = body.draft_letter;
    if ('disputed_finding_ids' in body) allowedFields.disputed_finding_ids = body.disputed_finding_ids;
    if ('recipient_email' in body) allowedFields.recipient_email = body.recipient_email;
    if ('recipient_name' in body) allowedFields.recipient_name = body.recipient_name;
    if ('total_disputed_amount' in body) allowedFields.total_disputed_amount = body.total_disputed_amount;

    const { data: updated, error: updateError } = await supabase
      .from('disputes')
      .update({ ...allowedFields, updated_at: new Date().toISOString() })
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating dispute:', updateError);
      return NextResponse.json({ error: 'Failed to update dispute' }, { status: 500 });
    }

    return NextResponse.json({ dispute: updated });
  } catch (error) {
    console.error('Error in PATCH /api/disputes/:disputeId:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 9: Run tests and commit**

Run: `pnpm test tests/lib/disputes/state-machine.test.ts tests/app/api/invoices/[id]/disputes/create.test.ts`
Expected: PASS

`git add lib/disputes/state-machine.ts app/api/invoices/[id]/disputes/create/route.ts app/api/disputes/[disputeId]/route.ts && git commit -m "feat: dispute CRUD routes and state machine"`

---

### Task 2: AI Dispute Letter Generation

**Files:**
- Create: `lib/disputes/generate-letter.ts`
- Create: `app/api/disputes/[disputeId]/generate-letter/route.ts`
- Test: `tests/lib/disputes/generate-letter.test.ts`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/disputes/generate-letter.test.ts
import { buildDisputeLetterPrompt, type GenerateLetterInput } from '@/lib/disputes/generate-letter';

const mockInput: GenerateLetterInput = {
  invoiceNumber: 'INV-2024-001',
  invoiceDate: '2024-01-15',
  carrierName: 'FastFreight Inc.',
  orgName: 'Acme Logistics LLC',
  findings: [
    {
      id: 'f-1',
      summary: 'Rate mismatch on line haul charge',
      description_edited: null,
      delta_amount: 125.50,
      amount_edited: null,
      charged_amount: 450.00,
      expected_amount: 324.50,
    },
    {
      id: 'f-2',
      summary: 'Fuel surcharge exceeds contracted cap of 18%',
      description_edited: 'Fuel surcharge billed at 22%, contracted cap is 18%',
      delta_amount: 89.00,
      amount_edited: 89.00,
      charged_amount: 198.00,
      expected_amount: 109.00,
    },
  ],
  totalDisputedAmount: 214.50,
};

describe('buildDisputeLetterPrompt', () => {
  it('returns a non-empty system prompt and user prompt', () => {
    const { systemPrompt, userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it('includes invoice number in the prompt', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('INV-2024-001');
  });

  it('includes carrier name in the prompt', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('FastFreight Inc.');
  });

  it('includes total disputed amount formatted as USD', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('214.50');
  });

  it('uses edited description when provided', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('Fuel surcharge billed at 22%');
  });

  it('uses edited amount when provided', () => {
    const { userPrompt } = buildDisputeLetterPrompt(mockInput);
    expect(userPrompt).toContain('$89.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/disputes/generate-letter.test.ts`
Expected: FAIL with "Cannot find module '@/lib/disputes/generate-letter'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/disputes/generate-letter.ts
import OpenAI from 'openai';

export interface FindingForLetter {
  id: string;
  summary: string;
  description_edited: string | null; // AP override; use this if set
  delta_amount: number;              // overcharge (positive = AP was billed too much)
  amount_edited: number | null;      // AP override for disputed amount
  charged_amount: number | null;
  expected_amount: number | null;
}

export interface GenerateLetterInput {
  invoiceNumber: string;
  invoiceDate: string;
  carrierName: string;
  orgName: string;
  findings: FindingForLetter[];
  totalDisputedAmount: number;
}

export function buildDisputeLetterPrompt(input: GenerateLetterInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `You are a professional freight billing dispute specialist writing on behalf of a shipper's accounts payable team.
Write formal, concise, and factual dispute letters. Use professional business letter tone.
Do not include placeholders like [Your Name] — use the provided data directly.
Structure: opening paragraph stating the dispute, numbered list of issues with amounts, closing paragraph requesting a credit memo or corrected invoice, professional sign-off.
Output only the letter body text — no preamble, no explanation, no markdown formatting.`;

  const findingLines = input.findings
    .map((f, i) => {
      const description = f.description_edited ?? f.summary;
      const disputedAmt = f.amount_edited ?? f.delta_amount;
      const chargedStr = f.charged_amount != null ? ` (charged: $${f.charged_amount.toFixed(2)}` : '';
      const expectedStr = f.expected_amount != null ? `, expected: $${f.expected_amount.toFixed(2)})` : chargedStr ? ')' : '';
      return `${i + 1}. ${description}${chargedStr}${expectedStr} — disputed amount: $${disputedAmt.toFixed(2)}`;
    })
    .join('\n');

  const userPrompt = `Write a formal freight invoice dispute letter with the following details:

Sender (AP Team): ${input.orgName}
Carrier: ${input.carrierName}
Invoice Number: ${input.invoiceNumber}
Invoice Date: ${input.invoiceDate}
Total Disputed Amount: $${input.totalDisputedAmount.toFixed(2)}

Disputed Charges:
${findingLines}

Request: Issue a credit memo for $${input.totalDisputedAmount.toFixed(2)} or provide a corrected invoice reflecting the contracted rates. Include a reference to the invoice number in the subject line suggestion.`;

  return { systemPrompt, userPrompt };
}

/**
 * Call OpenAI to generate a dispute letter.
 * Returns the letter as a plain-text string.
 */
export async function generateDisputeLetter(input: GenerateLetterInput): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { systemPrompt, userPrompt } = buildDisputeLetterPrompt(input);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1200,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const letter = response.choices[0]?.message?.content;
  if (!letter) {
    throw new Error('OpenAI returned empty letter content');
  }
  return letter.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/disputes/generate-letter.test.ts`
Expected: PASS

- [ ] **Step 5: Write the generate-letter route**

```typescript
// app/api/disputes/[disputeId]/generate-letter/route.ts
/**
 * POST /api/disputes/:disputeId/generate-letter
 *
 * (Re)generate an AI dispute letter from selected findings.
 * Persists the letter to disputes.draft_letter.
 * Allowed in 'draft' status only.
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { canEdit, type DisputeStatus } from '@/lib/disputes/state-machine';
import { generateDisputeLetter, type FindingForLetter } from '@/lib/disputes/generate-letter';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> | { disputeId: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.disputeId;

    if (!isValidUuid(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    // Fetch dispute + invoice + carrier + findings in parallel
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*, invoices(invoice_number, invoice_date, carriers(name_normalized))')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    if (!canEdit(dispute.status as DisputeStatus)) {
      return NextResponse.json(
        { error: `Cannot regenerate letter in status: ${dispute.status}` },
        { status: 422 }
      );
    }

    const findingIds: string[] = dispute.disputed_finding_ids ?? [];
    if (findingIds.length === 0) {
      return NextResponse.json(
        { error: 'No findings selected for dispute' },
        { status: 400 }
      );
    }

    const { data: findings, error: findingsError } = await supabase
      .from('findings')
      .select('id, summary, description_edited, delta_amount, amount_edited, charged_amount, expected_amount')
      .in('id', findingIds)
      .eq('org_id', orgId);

    if (findingsError || !findings) {
      return NextResponse.json({ error: 'Failed to fetch findings' }, { status: 500 });
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    const invoice = dispute.invoices as any;
    const carrier = invoice?.carriers as any;

    const totalDisputedAmount = (findings as FindingForLetter[]).reduce(
      (sum, f) => sum + (f.amount_edited ?? f.delta_amount),
      0
    );

    const letter = await generateDisputeLetter({
      invoiceNumber: invoice?.invoice_number ?? 'Unknown',
      invoiceDate: invoice?.invoice_date ?? '',
      carrierName: carrier?.name_normalized ?? 'Unknown Carrier',
      orgName: org?.name ?? 'Unknown Organization',
      findings: findings as FindingForLetter[],
      totalDisputedAmount,
    });

    // Persist generated letter + total back to dispute
    const { data: updated, error: updateError } = await supabase
      .from('disputes')
      .update({
        draft_letter: letter,
        total_disputed_amount: totalDisputedAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error saving generated letter:', updateError);
      return NextResponse.json({ error: 'Failed to save letter' }, { status: 500 });
    }

    return NextResponse.json({ dispute: updated, letter });
  } catch (error) {
    console.error('Error in POST /api/disputes/:disputeId/generate-letter:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run test and commit**

Run: `pnpm test tests/lib/disputes/generate-letter.test.ts`
Expected: PASS

`git add lib/disputes/generate-letter.ts app/api/disputes/[disputeId]/generate-letter/route.ts && git commit -m "feat: AI dispute letter generation with OpenAI gpt-4o"`

---

### Task 3: Send + Resolve API Routes

**Files:**
- Create: `app/api/disputes/[disputeId]/send/route.ts`
- Create: `app/api/disputes/[disputeId]/resolve/route.ts`
- Create: `lib/email/send-dispute.ts`
- Test: `tests/app/api/disputes/send.test.ts`
- Test: `tests/app/api/disputes/resolve.test.ts`

---

- [ ] **Step 1: Write the failing test for send route**

```typescript
// tests/app/api/disputes/send.test.ts
import { POST } from '@/app/api/disputes/[disputeId]/send/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: jest.fn() }));
jest.mock('@/lib/email/send-dispute', () => ({ sendDisputeEmail: jest.fn() }));

const { createClient } = require('@/lib/supabase/server');
const { getAuthOrgContext } = require('@/lib/server/auth-context');
const { sendDisputeEmail } = require('@/lib/email/send-dispute');

describe('POST /api/disputes/:disputeId/send', () => {
  beforeEach(() => {
    getAuthOrgContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' });
    sendDisputeEmail.mockResolvedValue({ threadId: 'thread-abc', messageId: 'msg-123' });
  });

  it('returns 422 when dispute is already resolved', async () => {
    const mockSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'dispute-1', status: 'resolved', draft_letter: 'letter', recipient_email: 'a@b.com' },
            error: null,
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const req = new NextRequest('http://localhost/api/disputes/dispute-1/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { disputeId: 'dispute-1' } });
    expect(res.status).toBe(422);
  });

  it('returns 400 when draft_letter is empty', async () => {
    const mockSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'dispute-1', status: 'draft', draft_letter: '', recipient_email: 'a@b.com' },
            error: null,
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const req = new NextRequest('http://localhost/api/disputes/dispute-1/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { disputeId: 'dispute-1' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/letter/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/api/disputes/send.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the email send helper**

```typescript
// lib/email/send-dispute.ts
/**
 * Send a dispute email from the AP team's connected mailbox.
 *
 * Supports Gmail (via googleapis) and Outlook (via Microsoft Graph).
 * Returns { threadId, messageId } on success — store threadId on disputes.email_thread_id.
 */

import { google } from 'googleapis';
import { createClient } from '@/lib/supabase/server';
import { decryptOAuthSecret } from '@/lib/server/oauth-token-crypto';

export interface SendDisputeEmailInput {
  orgId: string;
  userId: string;
  toEmail: string;
  toName?: string;
  subject: string;
  body: string;   // plain-text letter
  inReplyToThreadId?: string; // Gmail threadId for Round 2 sends
}

export interface SendDisputeEmailResult {
  threadId: string;
  messageId: string;
  provider: 'gmail' | 'outlook';
}

async function decryptToken(encrypted: string): Promise<string> {
  return decryptOAuthSecret(encrypted);
}

async function sendViaGmail(
  accessToken: string,
  input: SendDisputeEmailInput,
  inReplyToThreadId?: string
): Promise<SendDisputeEmailResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const toHeader = input.toName
    ? `"${input.toName}" <${input.toEmail}>`
    : input.toEmail;

  const rawLines = [
    `To: ${toHeader}`,
    `Subject: ${input.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    input.body,
  ];
  const rawMessage = rawLines.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      ...(inReplyToThreadId ? { threadId: inReplyToThreadId } : {}),
    },
  });

  return {
    threadId: result.data.threadId ?? '',
    messageId: result.data.id ?? '',
    provider: 'gmail',
  };
}

async function sendViaOutlook(
  accessToken: string,
  input: SendDisputeEmailInput
): Promise<SendDisputeEmailResult> {
  // Create draft → send → GET message for real conversationId (inbound replies match on conversationId)
  const createRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: 'Text', content: input.body },
      toRecipients: [
        { emailAddress: { address: input.toEmail, name: input.toName } },
      ],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Outlook create message failed: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string; conversationId?: string };
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${created.id}/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!sendRes.ok) {
    throw new Error(`Outlook send failed: ${await sendRes.text()}`);
  }
  const getRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${created.id}?$select=id,conversationId`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const sent = (await getRes.json()) as { id: string; conversationId?: string };
  return {
    threadId: sent.conversationId ?? created.conversationId ?? '',
    messageId: sent.id,
    provider: 'outlook',
  };
}

export async function sendDisputeEmail(
  input: SendDisputeEmailInput
): Promise<SendDisputeEmailResult> {
  const supabase = await createClient();

  // Find the active email connection for this org+user
  const { data: connection, error: connError } = await supabase
    .from('email_connections')
    .select('id, provider')
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (connError || !connection) {
    throw new Error('No active email connection found. Please reconnect your mailbox.');
  }

  // Fetch OAuth token
  const { data: token, error: tokenError } = await supabase
    .from('oauth_tokens')
    .select('access_token_encrypted, refresh_token_encrypted, expires_at')
    .eq('connection_id', connection.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (tokenError || !token || !token.access_token_encrypted) {
    throw new Error('OAuth token not found or expired. Please reconnect your mailbox.');
  }

  const accessToken = await decryptToken(token.access_token_encrypted);

  if (connection.provider === 'gmail') {
    return sendViaGmail(accessToken, input, input.inReplyToThreadId);
  } else if (connection.provider === 'outlook') {
    return sendViaOutlook(accessToken, input);
  } else {
    throw new Error(`Unsupported email provider: ${connection.provider}`);
  }
}
```

Create **`lib/server/oauth-token-crypto.ts`** (referenced above; `@google-cloud/kms` is already a project dependency):

```typescript
import { KeyManagementServiceClient } from '@google-cloud/kms';

const kms = new KeyManagementServiceClient();

export async function decryptOAuthSecret(ciphertext: string): Promise<string> {
  const keyName = process.env.OAUTH_KMS_KEY_NAME;
  if (!keyName) {
    if (process.env.NODE_ENV === 'development') {
      return Buffer.from(ciphertext, 'base64').toString('utf-8');
    }
    throw new Error('OAUTH_KMS_KEY_NAME is not configured');
  }
  const [result] = await kms.decrypt({
    name: keyName,
    ciphertext: Buffer.from(ciphertext, 'base64'),
  });
  return result.plaintext!.toString('utf-8');
}
```

**Audit `FindingDraft` vs letter `FindingForLetter`:** Define **`lib/disputes/letter-types.ts`** as the bridge so letter code does not import audit pipeline internals:

```typescript
import type { FindingDraft } from '@/lib/audit/types';

/** Subset passed to PDF/HTML dispute letter (Audit Pipeline Plan Task 8). */
export type FindingForLetter = Pick<
  FindingDraft,
  'rule_id' | 'finding_type' | 'summary' | 'delta_amount'
> & { amount_edited?: number | null };
```

If `lib/audit/types.ts` is not merged yet, inline the same fields temporarily and replace with `Pick<FindingDraft, …>` once the audit plan lands.

- [ ] **Step 4: Write the send route**

```typescript
// app/api/disputes/[disputeId]/send/route.ts
/**
 * POST /api/disputes/:disputeId/send
 *
 * Send the dispute email from AP's connected mailbox.
 * - Validates status transition (draft|carrier_replied → sent)
 * - Sends via Gmail or Outlook
 * - Appends outbound dispute_message
 * - Updates disputes.status = 'sent', stores email_thread_id on first send
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { assertTransition, type DisputeStatus } from '@/lib/disputes/state-machine';
import { sendDisputeEmail } from '@/lib/email/send-dispute';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> | { disputeId: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId, userId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.disputeId;

    if (!isValidUuid(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('*, invoices(invoice_number)')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    // Guard: state transition
    try {
      assertTransition(dispute.status as DisputeStatus, 'sent');
    } catch {
      return NextResponse.json(
        { error: `Invalid transition: cannot send from status '${dispute.status}'` },
        { status: 422 }
      );
    }

    // Guard: letter must be non-empty
    if (!dispute.draft_letter?.trim()) {
      return NextResponse.json(
        { error: 'Cannot send: dispute letter is empty. Please generate a letter first.' },
        { status: 400 }
      );
    }

    // Guard: recipient email required
    const body = await request.json().catch(() => ({}));
    const recipientEmail: string = body.recipient_email ?? dispute.recipient_email;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email is required' },
        { status: 400 }
      );
    }

    const { data: invRow } = await supabase
      .from('invoices')
      .select('carrier_id, carriers ( billing_email, billing_email_confirmed )')
      .eq('id', dispute.invoice_id)
      .eq('org_id', orgId)
      .single();
    const carrierRow = invRow?.carriers as {
      billing_email?: string | null;
      billing_email_confirmed?: boolean;
    } | null;
    if (
      carrierRow?.billing_email &&
      recipientEmail.toLowerCase() === carrierRow.billing_email.toLowerCase() &&
      !carrierRow.billing_email_confirmed
    ) {
      return NextResponse.json(
        { error: 'BILLING_EMAIL_UNCONFIRMED', carrier_id: invRow?.carrier_id },
        { status: 409 }
      );
    }

    const invoiceNumber = (dispute.invoices as any)?.invoice_number ?? 'Unknown';
    const subject = body.subject ?? `Freight Invoice Dispute — Invoice ${invoiceNumber}`;

    // Send email
    let sendResult;
    try {
      sendResult = await sendDisputeEmail({
        orgId,
        userId,
        toEmail: recipientEmail,
        toName: body.recipient_name ?? dispute.recipient_name ?? undefined,
        subject,
        body: dispute.draft_letter,
        inReplyToThreadId: dispute.email_thread_id ?? undefined,
      });
    } catch (sendError: any) {
      console.error('Email send failed:', sendError);
      return NextResponse.json(
        { error: sendError.message ?? 'Failed to send email' },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();

    // Append outbound dispute_message
    await supabase.from('dispute_messages').insert({
      org_id: orgId,
      dispute_id: disputeId,
      direction: 'outbound',
      from_email: null, // AP's connected mailbox (provider-side)
      to_emails: [recipientEmail],
      subject,
      body: dispute.draft_letter,
      email_message_id: sendResult.messageId,
      email_thread_id: sendResult.threadId,
      sent_at: now,
    });

    // Update dispute status + store thread_id on first send
    const updatePayload: Record<string, unknown> = {
      status: 'sent',
      recipient_email: recipientEmail,
      updated_at: now,
    };
    if (!dispute.email_thread_id) {
      updatePayload.email_thread_id = sendResult.threadId;
    }

    const { data: updated } = await supabase
      .from('disputes')
      .update(updatePayload)
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    return NextResponse.json({ dispute: updated, thread_id: sendResult.threadId });
  } catch (error) {
    console.error('Error in POST /api/disputes/:disputeId/send:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Write the failing test for resolve route**

```typescript
// tests/app/api/disputes/resolve.test.ts
import { POST } from '@/app/api/disputes/[disputeId]/resolve/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/server/auth-context', () => ({ getAuthOrgContext: jest.fn() }));

const { createClient } = require('@/lib/supabase/server');
const { getAuthOrgContext } = require('@/lib/server/auth-context');

describe('POST /api/disputes/:disputeId/resolve', () => {
  beforeEach(() => {
    getAuthOrgContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' });
  });

  it('returns 422 when already resolved', async () => {
    const fromMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'dispute-1', status: 'resolved', invoice_id: 'inv-1' },
              error: null,
            }),
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: fromMock });

    const req = new NextRequest('http://localhost/api/disputes/dispute-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ recovered_amount: 200 }),
    });
    const res = await POST(req, { params: { disputeId: 'dispute-1' } });
    expect(res.status).toBe(422);
  });

  it('returns 400 when recovered_amount is missing', async () => {
    const fromMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 'dispute-1', status: 'sent', invoice_id: 'inv-1' },
              error: null,
            }),
          }),
        }),
      }),
    });
    createClient.mockResolvedValue({ from: fromMock });

    const req = new NextRequest('http://localhost/api/disputes/dispute-1/resolve', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { disputeId: 'dispute-1' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/app/api/disputes/resolve.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 7: Write the resolve route**

```typescript
// app/api/disputes/[disputeId]/resolve/route.ts
/**
 * POST /api/disputes/:disputeId/resolve
 *
 * Mark dispute as resolved.
 * - Sets disputes.status = 'resolved', disputes.recovered_amount
 * - Sets invoices.ui_status = 'archived'
 */

import { createClient } from '@/lib/supabase/server';
import { getAuthOrgContext } from '@/lib/server/auth-context';
import { isValidUuid } from '@/lib/utils';
import { assertTransition, type DisputeStatus } from '@/lib/disputes/state-machine';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> | { disputeId: string } }
) {
  try {
    const supabase = await createClient();
    const authContext = await getAuthOrgContext(supabase);
    if (!authContext) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { orgId } = authContext;

    const resolvedParams = 'then' in params ? await params : params;
    const disputeId = resolvedParams.disputeId;

    if (!isValidUuid(disputeId)) {
      return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });
    }

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('id, status, invoice_id')
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    try {
      assertTransition(dispute.status as DisputeStatus, 'resolved');
    } catch {
      return NextResponse.json(
        { error: `Cannot resolve dispute in status '${dispute.status}'` },
        { status: 422 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const recoveredAmount = body.recovered_amount;

    if (recoveredAmount === undefined || recoveredAmount === null) {
      return NextResponse.json(
        { error: 'recovered_amount is required' },
        { status: 400 }
      );
    }

    if (typeof recoveredAmount !== 'number' || recoveredAmount < 0) {
      return NextResponse.json(
        { error: 'recovered_amount must be a non-negative number' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Update dispute
    const { data: updatedDispute, error: updateError } = await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        recovered_amount: recoveredAmount,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', disputeId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) {
      console.error('Error resolving dispute:', updateError);
      return NextResponse.json({ error: 'Failed to resolve dispute' }, { status: 500 });
    }

    // Archive the invoice
    await supabase
      .from('invoices')
      .update({ ui_status: 'archived', updated_at: now })
      .eq('id', dispute.invoice_id)
      .eq('org_id', orgId);

    return NextResponse.json({ dispute: updatedDispute });
  } catch (error) {
    console.error('Error in POST /api/disputes/:disputeId/resolve:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run tests and commit**

Run: `pnpm test tests/app/api/disputes/send.test.ts tests/app/api/disputes/resolve.test.ts`
Expected: PASS

`git add app/api/disputes/[disputeId]/send/route.ts app/api/disputes/[disputeId]/resolve/route.ts lib/email/send-dispute.ts && git commit -m "feat: dispute send and resolve routes with state guard"`

---

### Task 4: Dispute Draft UI Panel

**Files:**
- Create: `app/components/disputes/DisputeDraftPanel.tsx`
- Create: `lib/api/disputes.ts` (client-side API helpers)
- Test: `tests/components/disputes/DisputeDraftPanel.test.tsx`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/disputes/DisputeDraftPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DisputeDraftPanel from '@/app/components/disputes/DisputeDraftPanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockDispute = {
  id: 'dispute-1',
  status: 'draft' as const,
  draft_letter: 'Dear FastFreight,\n\nWe dispute the following charges...',
  disputed_finding_ids: ['f-1'],
  recipient_email: 'billing@fastfreight.com',
  recipient_name: 'Billing Team',
  total_disputed_amount: 214.50,
};

const mockFindings = [
  { id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null },
  { id: 'f-2', summary: 'Fuel surcharge cap exceeded', delta_amount: 89.00, amount_edited: 89.00 },
];

const mockCarrier = {
  id: 'carrier-1',
  billing_email: 'billing@fastfreight.com',
  billing_email_confirmed: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('DisputeDraftPanel', () => {
  it('renders the letter textarea with existing draft_letter', () => {
    render(
      <DisputeDraftPanel
        dispute={mockDispute}
        findings={mockFindings}
        carrier={mockCarrier}
        invoiceId="inv-1"
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByDisplayValue(/We dispute the following charges/)).toBeInTheDocument();
  });

  it('renders the recipient email field pre-populated', () => {
    render(
      <DisputeDraftPanel
        dispute={mockDispute}
        findings={mockFindings}
        carrier={mockCarrier}
        invoiceId="inv-1"
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByDisplayValue('billing@fastfreight.com')).toBeInTheDocument();
  });

  it('shows total disputed amount', () => {
    render(
      <DisputeDraftPanel
        dispute={mockDispute}
        findings={mockFindings}
        carrier={mockCarrier}
        invoiceId="inv-1"
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText(/\$214\.50/)).toBeInTheDocument();
  });

  it('shows Send Dispute button', () => {
    render(
      <DisputeDraftPanel
        dispute={mockDispute}
        findings={mockFindings}
        carrier={mockCarrier}
        invoiceId="inv-1"
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /send dispute/i })).toBeInTheDocument();
  });

  it('shows Regenerate button', () => {
    render(
      <DisputeDraftPanel
        dispute={mockDispute}
        findings={mockFindings}
        carrier={mockCarrier}
        invoiceId="inv-1"
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/disputes/DisputeDraftPanel.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the client-side API helpers**

```typescript
// lib/api/disputes.ts
/**
 * Client-side API helpers for dispute workflow.
 * All calls use credentials: 'same-origin' — cookies sent for auth.
 */

export type DisputeStatus = 'draft' | 'sent' | 'carrier_replied' | 'resolved';

export interface Dispute {
  id: string;
  invoice_id: string;
  org_id: string;
  status: DisputeStatus;
  disputed_finding_ids: string[];
  total_disputed_amount: number;
  draft_letter: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  email_thread_id: string | null;
  recovered_amount: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisputeMessage {
  id: string;
  dispute_id: string;
  direction: 'outbound' | 'inbound';
  from_email: string | null;
  to_emails: string[];
  subject: string | null;
  body: string;
  email_message_id: string | null;
  email_thread_id: string | null;
  sent_at: string;
  created_at: string;
}

export async function fetchDisputeByInvoice(invoiceId: string): Promise<Dispute | null> {
  const res = await fetch(`/api/invoices/${invoiceId}/disputes`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch dispute');
  const data = await res.json();
  return data.dispute ?? null;
}

export async function fetchDisputeWithMessages(
  disputeId: string
): Promise<{ dispute: Dispute; messages: DisputeMessage[] }> {
  const res = await fetch(`/api/disputes/${disputeId}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to fetch dispute');
  return res.json();
}

export async function createDraftDispute(
  invoiceId: string,
  disputedFindingIds: string[]
): Promise<Dispute> {
  const res = await fetch(`/api/invoices/${invoiceId}/disputes/create`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disputed_finding_ids: disputedFindingIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Failed to create dispute');
  }
  const data = await res.json();
  return data.dispute;
}

export async function updateDispute(
  disputeId: string,
  patch: Partial<Pick<Dispute, 'draft_letter' | 'disputed_finding_ids' | 'recipient_email' | 'recipient_name' | 'total_disputed_amount'>>
): Promise<Dispute> {
  const res = await fetch(`/api/disputes/${disputeId}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Failed to update dispute');
  const data = await res.json();
  return data.dispute;
}

export async function generateLetter(disputeId: string): Promise<{ dispute: Dispute; letter: string }> {
  const res = await fetch(`/api/disputes/${disputeId}/generate-letter`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('Failed to generate letter');
  return res.json();
}

export async function sendDispute(
  disputeId: string,
  opts: { recipient_email?: string; recipient_name?: string; subject?: string }
): Promise<{ dispute: Dispute; thread_id: string }> {
  const res = await fetch(`/api/disputes/${disputeId}/send`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Failed to send dispute');
  }
  return res.json();
}

export async function resolveDispute(
  disputeId: string,
  recoveredAmount: number
): Promise<Dispute> {
  const res = await fetch(`/api/disputes/${disputeId}/resolve`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recovered_amount: recoveredAmount }),
  });
  if (!res.ok) throw new Error('Failed to resolve dispute');
  const data = await res.json();
  return data.dispute;
}
```

- [ ] **Step 4: Write the DisputeDraftPanel component**

```tsx
// app/components/disputes/DisputeDraftPanel.tsx
'use client';

import { useState } from 'react';
import { RefreshCw, Send, DollarSign } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import { updateDispute, generateLetter, sendDispute } from '@/lib/api/disputes';

interface Finding {
  id: string;
  summary: string;
  delta_amount: number;
  amount_edited: number | null;
}

interface Carrier {
  id: string;
  billing_email: string | null;
  billing_email_confirmed: boolean;
}

interface DisputeDraftPanelProps {
  dispute: Dispute;
  findings: Finding[];
  carrier: Carrier;
  invoiceId: string;
  onDisputeUpdated: (updated: Dispute) => void;
}

export default function DisputeDraftPanel({
  dispute,
  findings,
  carrier,
  invoiceId,
  onDisputeUpdated,
}: DisputeDraftPanelProps) {
  const [letter, setLetter] = useState(dispute.draft_letter ?? '');
  const [recipientEmail, setRecipientEmail] = useState(dispute.recipient_email ?? carrier.billing_email ?? '');
  const [recipientName, setRecipientName] = useState(dispute.recipient_name ?? '');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected findings (checked in UI)
  const selectedFindings = findings.filter(f =>
    dispute.disputed_finding_ids.includes(f.id)
  );
  const totalDisputed = selectedFindings.reduce(
    (sum, f) => sum + (f.amount_edited ?? f.delta_amount),
    0
  );

  const handleLetterBlur = async () => {
    if (letter === dispute.draft_letter) return;
    setSaving(true);
    try {
      const updated = await updateDispute(dispute.id, { draft_letter: letter });
      onDisputeUpdated(updated);
    } catch {
      setError('Failed to save letter changes');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { dispute: updated, letter: newLetter } = await generateLetter(dispute.id);
      setLetter(newLetter);
      onDisputeUpdated(updated);
    } catch (e: any) {
      setError(e.message ?? 'Failed to regenerate letter');
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      setError('Recipient email is required');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { dispute: updated } = await sendDispute(dispute.id, {
        recipient_email: recipientEmail,
        recipient_name: recipientName || undefined,
      });
      onDisputeUpdated(updated);
    } catch (e: any) {
      setError(e.message ?? 'Failed to send dispute');
    } finally {
      setSending(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Left: letter editor */}
      <div className="flex-1 flex flex-col gap-3">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Dispute Letter</h3>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-gray-500">Saving…</span>}
            <button
              onClick={handleRegenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>

        <textarea
          value={letter}
          onChange={e => setLetter(e.target.value)}
          onBlur={handleLetterBlur}
          rows={16}
          placeholder="Click 'Regenerate' to generate an AI dispute letter from your selected findings."
          className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
        />

        {/* Recipient fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recipient Email *
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              placeholder="billing@carrier.com"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recipient Name
            </label>
            <input
              type="text"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              placeholder="Billing Team"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <button
          onClick={() => setShowConfirm(true)}
          disabled={!letter.trim() || !recipientEmail.trim() || sending}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          Send Dispute
        </button>
      </div>

      {/* Right: findings summary */}
      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Disputed Charges</h3>
        <div className="space-y-2">
          {selectedFindings.length === 0 ? (
            <p className="text-xs text-gray-500">No findings selected.</p>
          ) : (
            selectedFindings.map(f => (
              <div key={f.id} className="flex justify-between items-start gap-2">
                <span className="text-xs text-gray-700 leading-snug">{f.summary}</span>
                <span className="text-xs font-medium text-red-600 whitespace-nowrap">
                  ${(f.amount_edited ?? f.delta_amount).toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
        {selectedFindings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-900">Total</span>
            <span className="text-sm font-bold text-red-600">${totalDisputed.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Send confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Send</h3>
            <p className="text-sm text-gray-600 mb-1">
              Send dispute letter to <strong>{recipientEmail}</strong>?
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Total disputed: <strong className="text-red-600">${totalDisputed.toFixed(2)}</strong>
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={sending}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/components/disputes/DisputeDraftPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

`git add app/components/disputes/DisputeDraftPanel.tsx lib/api/disputes.ts && git commit -m "feat: DisputeDraftPanel UI with letter editor and findings summary"`

---

### Task 5: Billing Email Confirmation Modal

**Files:**
- Create: `app/components/disputes/BillingEmailConfirmModal.tsx`
- Test: `tests/components/disputes/BillingEmailConfirmModal.test.tsx`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/disputes/BillingEmailConfirmModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import BillingEmailConfirmModal from '@/app/components/disputes/BillingEmailConfirmModal';

describe('BillingEmailConfirmModal', () => {
  const defaultProps = {
    carrierName: 'FastFreight Inc.',
    billingEmail: 'billing@fastfreight.com',
    onConfirm: jest.fn(),
    onClose: jest.fn(),
  };

  it('renders carrier name and email', () => {
    render(<BillingEmailConfirmModal {...defaultProps} />);
    expect(screen.getByText(/FastFreight Inc./)).toBeInTheDocument();
    expect(screen.getByDisplayValue('billing@fastfreight.com')).toBeInTheDocument();
  });

  it('calls onConfirm with current email on Confirm & Send click', () => {
    render(<BillingEmailConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm & send/i }));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('billing@fastfreight.com');
  });

  it('calls onConfirm with edited email', () => {
    render(<BillingEmailConfirmModal {...defaultProps} />);
    const input = screen.getByDisplayValue('billing@fastfreight.com');
    fireEvent.change(input, { target: { value: 'ar@fastfreight.com' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm & send/i }));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith('ar@fastfreight.com');
  });

  it('calls onClose on Cancel', () => {
    render(<BillingEmailConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('disables Confirm & Send when email is empty', () => {
    render(<BillingEmailConfirmModal {...defaultProps} billingEmail="" />);
    const btn = screen.getByRole('button', { name: /confirm & send/i });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/disputes/BillingEmailConfirmModal.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/disputes/BillingEmailConfirmModal.tsx
'use client';

import { useState } from 'react';
import { Mail, AlertCircle } from 'lucide-react';

interface BillingEmailConfirmModalProps {
  carrierName: string;
  billingEmail: string;
  onConfirm: (confirmedEmail: string) => void;
  onClose: () => void;
}

export default function BillingEmailConfirmModal({
  carrierName,
  billingEmail,
  onConfirm,
  onClose,
}: BillingEmailConfirmModalProps) {
  const [email, setEmail] = useState(billingEmail);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-50 rounded-full">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Confirm Billing Email</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Before sending to <strong>{carrierName}</strong> for the first time, please confirm
          the billing email address is correct. This will be saved for future disputes with
          this carrier.
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Carrier Billing Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="billing@carrier.com"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Edit if the extracted address is incorrect.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(email)}
            disabled={!email.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mail className="w-4 h-4" />
            Confirm & Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/disputes/BillingEmailConfirmModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

`git add app/components/disputes/BillingEmailConfirmModal.tsx && git commit -m "feat: BillingEmailConfirmModal for first-send to a carrier"`

---

### Task 6: Dispute Active Panel (sent / carrier_replied)

**Files:**
- Create: `app/components/disputes/DisputeActivePanel.tsx`
- Test: `tests/components/disputes/DisputeActivePanel.test.tsx`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/disputes/DisputeActivePanel.test.tsx
import { render, screen } from '@testing-library/react';
import DisputeActivePanel from '@/app/components/disputes/DisputeActivePanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockDispute = {
  id: 'dispute-1',
  status: 'sent' as const,
  draft_letter: 'Dear FastFreight,\n\nWe dispute the following...',
  disputed_finding_ids: ['f-1'],
  recipient_email: 'billing@fastfreight.com',
  recipient_name: 'Billing Team',
  total_disputed_amount: 214.50,
  email_thread_id: 'thread-abc',
  recovered_amount: null,
  resolved_at: null,
  invoice_id: 'inv-1',
  org_id: 'org-1',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const mockMessages = [
  {
    id: 'msg-1',
    dispute_id: 'dispute-1',
    direction: 'outbound' as const,
    from_email: null,
    to_emails: ['billing@fastfreight.com'],
    subject: 'Freight Invoice Dispute — Invoice INV-2024-001',
    body: 'Dear FastFreight,\n\nWe dispute the following...',
    email_message_id: 'gm-1',
    email_thread_id: 'thread-abc',
    sent_at: '2024-01-15T10:00:00Z',
    created_at: '2024-01-15T10:00:00Z',
  },
];

const mockFindings = [
  { id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('DisputeActivePanel', () => {
  it('renders the outbound message in history', () => {
    render(
      <DisputeActivePanel
        dispute={mockDispute}
        messages={mockMessages}
        findings={mockFindings}
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText(/We dispute the following/)).toBeInTheDocument();
  });

  it('labels outbound messages as "Sent by you"', () => {
    render(
      <DisputeActivePanel
        dispute={mockDispute}
        messages={mockMessages}
        findings={mockFindings}
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByText(/sent by you/i)).toBeInTheDocument();
  });

  it('shows Mark Resolved button', () => {
    render(
      <DisputeActivePanel
        dispute={mockDispute}
        messages={mockMessages}
        findings={mockFindings}
        onDisputeUpdated={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/disputes/DisputeActivePanel.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/disputes/DisputeActivePanel.tsx
'use client';

import { useState } from 'react';
import { CheckCircle2, ArrowDownLeft, ArrowUpRight, Send } from 'lucide-react';
import type { Dispute, DisputeMessage } from '@/lib/api/disputes';
import { sendDispute, updateDispute } from '@/lib/api/disputes';
import ResolveDisputeModal from './ResolveDisputeModal';

interface Finding {
  id: string;
  summary: string;
  delta_amount: number;
  amount_edited: number | null;
}

interface DisputeActivePanelProps {
  dispute: Dispute;
  messages: DisputeMessage[];
  findings: Finding[];
  onDisputeUpdated: (updated: Dispute) => void;
}

export default function DisputeActivePanel({
  dispute,
  messages,
  findings,
  onDisputeUpdated,
}: DisputeActivePanelProps) {
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [round2Letter, setRound2Letter] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accepted findings = those NOT in the disputed set (AP unchecked them)
  const acceptedFindingIds = findings
    .filter(f => !dispute.disputed_finding_ids.includes(f.id))
    .map(f => f.id);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleSendRound2 = async () => {
    if (!round2Letter.trim()) return;
    setSending(true);
    setError(null);
    try {
      // Save round2 letter as new draft_letter then send
      await updateDispute(dispute.id, { draft_letter: round2Letter });
      const { dispute: updated } = await sendDispute(dispute.id, {
        recipient_email: dispute.recipient_email ?? undefined,
        recipient_name: dispute.recipient_name ?? undefined,
      });
      setRound2Letter('');
      onDisputeUpdated(updated);
    } catch (e: any) {
      setError(e.message ?? 'Failed to send follow-up');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* Left: message history + round 2 */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Dispute History</h3>
          <button
            onClick={() => setShowResolveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark Resolved
          </button>
        </div>

        {/* Immutable message thread */}
        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`rounded-lg border p-4 ${
                msg.direction === 'outbound'
                  ? 'bg-indigo-50 border-indigo-200'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {msg.direction === 'outbound' ? (
                    <ArrowUpRight className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4 text-gray-600" />
                  )}
                  <span className="text-xs font-medium text-gray-700">
                    {msg.direction === 'outbound' ? 'Sent by you' : `Carrier reply`}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{formatDate(msg.sent_at)}</span>
              </div>
              {msg.subject && (
                <p className="text-xs font-medium text-gray-600 mb-1">{msg.subject}</p>
              )}
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                {msg.body}
              </pre>
            </div>
          ))}
        </div>

        {/* Round 2 letter area */}
        {dispute.status !== 'resolved' && (
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Send Follow-up</h4>
            <textarea
              value={round2Letter}
              onChange={e => setRound2Letter(e.target.value)}
              rows={8}
              placeholder="Write a follow-up letter if the carrier hasn't responded or you need to escalate..."
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
            />
            <button
              onClick={handleSendRound2}
              disabled={!round2Letter.trim() || sending}
              className="mt-2 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : 'Send Follow-up'}
            </button>
          </div>
        )}
      </div>

      {/* Right: findings panel */}
      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Findings</h3>
        <div className="space-y-2">
          {findings.map(f => {
            const isAccepted = acceptedFindingIds.includes(f.id);
            return (
              <div
                key={f.id}
                className={`flex justify-between items-start gap-2 ${isAccepted ? 'opacity-60' : ''}`}
              >
                <span
                  className={`text-xs leading-snug ${
                    isAccepted ? 'line-through text-green-700' : 'text-gray-700'
                  }`}
                >
                  {f.summary}
                </span>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    isAccepted ? 'line-through text-green-600' : 'text-red-600'
                  }`}
                >
                  ${(f.amount_edited ?? f.delta_amount).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-900">Total Disputed</span>
          <span className="text-sm font-bold text-red-600">
            ${dispute.total_disputed_amount.toFixed(2)}
          </span>
        </div>
      </div>

      {showResolveModal && (
        <ResolveDisputeModal
          dispute={dispute}
          onResolved={onDisputeUpdated}
          onClose={() => setShowResolveModal(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/disputes/DisputeActivePanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

`git add app/components/disputes/DisputeActivePanel.tsx && git commit -m "feat: DisputeActivePanel with immutable history log and round-2 send"`

---

### Task 7: Resolution Modal

**Files:**
- Create: `app/components/disputes/ResolveDisputeModal.tsx`
- Test: `tests/components/disputes/ResolveDisputeModal.test.tsx`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/disputes/ResolveDisputeModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResolveDisputeModal from '@/app/components/disputes/ResolveDisputeModal';

jest.mock('@/lib/api/disputes', () => ({
  resolveDispute: jest.fn(),
}));

const { resolveDispute } = require('@/lib/api/disputes');

const mockDispute = {
  id: 'dispute-1',
  status: 'sent',
  total_disputed_amount: 214.50,
  invoice_id: 'inv-1',
};

describe('ResolveDisputeModal', () => {
  it('renders the total disputed amount as a hint', () => {
    render(
      <ResolveDisputeModal
        dispute={mockDispute as any}
        onResolved={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(/\$214\.50/)).toBeInTheDocument();
  });

  it('calls resolveDispute with parsed amount on confirm', async () => {
    resolveDispute.mockResolvedValueOnce({ ...mockDispute, status: 'resolved', recovered_amount: 150 });

    const onResolved = jest.fn();
    render(
      <ResolveDisputeModal
        dispute={mockDispute as any}
        onResolved={onResolved}
        onClose={jest.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/0\.00/);
    fireEvent.change(input, { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm resolution/i }));

    await waitFor(() => {
      expect(resolveDispute).toHaveBeenCalledWith('dispute-1', 150);
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it('disables Confirm Resolution when amount is empty', () => {
    render(
      <ResolveDisputeModal
        dispute={mockDispute as any}
        onResolved={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /confirm resolution/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/disputes/ResolveDisputeModal.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/disputes/ResolveDisputeModal.tsx
'use client';

import { useState } from 'react';
import { CheckCircle2, DollarSign } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import { resolveDispute } from '@/lib/api/disputes';

interface ResolveDisputeModalProps {
  dispute: Dispute;
  onResolved: (updated: Dispute) => void;
  onClose: () => void;
}

export default function ResolveDisputeModal({
  dispute,
  onResolved,
  onClose,
}: ResolveDisputeModalProps) {
  const [amount, setAmount] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount);
  const isValid = amount.trim() !== '' && !isNaN(parsedAmount) && parsedAmount >= 0;

  const handleConfirm = async () => {
    if (!isValid) return;
    setResolving(true);
    setError(null);
    try {
      const updated = await resolveDispute(dispute.id, parsedAmount);
      onResolved(updated);
    } catch (e: any) {
      setError(e.message ?? 'Failed to resolve dispute');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-50 rounded-full">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Mark Dispute Resolved</h3>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4">
          Enter the amount actually recovered. This will archive the invoice and close the dispute.
          Total originally disputed:{' '}
          <strong className="text-gray-900">${dispute.total_disputed_amount.toFixed(2)}</strong>
        </p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Amount Recovered (USD)
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Enter 0 if no recovery was obtained. Enter the full amount or partial credit received.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={resolving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid || resolving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" />
            {resolving ? 'Resolving…' : 'Confirm Resolution'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/disputes/ResolveDisputeModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

`git add app/components/disputes/ResolveDisputeModal.tsx && git commit -m "feat: ResolveDisputeModal with recovered amount input"`

---

### Task 8: Carrier Reply Ingestion (Inngest Function)

**Files:**
- Create: `lib/inngest/client.ts`
- Create: `lib/inngest/functions/handle-inbound-email.ts`
- Create: `app/api/inngest/route.ts`
- Test: `tests/lib/inngest/handle-inbound-email.test.ts`

---

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/inngest/handle-inbound-email.test.ts
// Unit test for the matching logic — no actual Inngest SDK calls

import { matchInboundEmailToDispute } from '@/lib/inngest/functions/handle-inbound-email';

describe('matchInboundEmailToDispute', () => {
  it('returns the dispute whose email_thread_id matches the inbound thread', () => {
    const disputes = [
      { id: 'd-1', email_thread_id: 'thread-abc', status: 'sent' },
      { id: 'd-2', email_thread_id: 'thread-xyz', status: 'sent' },
    ];
    const result = matchInboundEmailToDispute(disputes, 'thread-abc');
    expect(result?.id).toBe('d-1');
  });

  it('returns null when no dispute matches', () => {
    const disputes = [{ id: 'd-1', email_thread_id: 'thread-abc', status: 'sent' }];
    expect(matchInboundEmailToDispute(disputes, 'thread-no-match')).toBeNull();
  });

  it('returns null when disputes list is empty', () => {
    expect(matchInboundEmailToDispute([], 'thread-abc')).toBeNull();
  });

  it('does not match a resolved dispute', () => {
    const disputes = [{ id: 'd-1', email_thread_id: 'thread-abc', status: 'resolved' }];
    expect(matchInboundEmailToDispute(disputes, 'thread-abc')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/inngest/handle-inbound-email.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the Inngest client and function**

```typescript
// lib/inngest/client.ts
import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'sifter' });
```

```typescript
// lib/inngest/functions/handle-inbound-email.ts
/**
 * Inngest function: handle-inbound-email
 *
 * Triggered by `email.received` event from the Gmail/Outlook poller.
 * Matches the inbound email to an open dispute by email_thread_id.
 * If matched:
 *   - Appends inbound dispute_message row
 *   - Sets disputes.status = 'carrier_replied'
 *   - Emits notification.created event (stub; Plan 5 implements notifications)
 * If not matched:
 *   - Emits email.unmatched event for the document ingestion pipeline
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@/lib/supabase/server';

interface InboundEmailEvent {
  data: {
    org_id: string;
    thread_id: string;
    message_id: string;
    from_email: string;
    to_emails: string[];
    cc_emails?: string[];
    subject: string;
    body: string;
    received_at: string;
  };
}

/** Pure matching logic — exported for unit testing */
export function matchInboundEmailToDispute(
  disputes: Array<{ id: string; email_thread_id: string | null; status: string }>,
  threadId: string
): { id: string; email_thread_id: string | null; status: string } | null {
  return (
    disputes.find(
      d =>
        d.email_thread_id === threadId &&
        d.status !== 'resolved'
    ) ?? null
  );
}

export const handleInboundEmail = inngest.createFunction(
  { id: 'handle-inbound-email', name: 'Handle Inbound Email' },
  { event: 'email.received' },
  async ({ event, step }: { event: InboundEmailEvent; step: any }) => {
    const { org_id, thread_id, message_id, from_email, to_emails, cc_emails, subject, body, received_at } =
      event.data;

    const supabase = await createClient();

    // Step 1: Find all open disputes for this org with a thread_id set
    const matchedDispute = await step.run('match-dispute', async () => {
      const { data: disputes } = await supabase
        .from('disputes')
        .select('id, email_thread_id, status')
        .eq('org_id', org_id)
        .not('email_thread_id', 'is', null)
        .neq('status', 'resolved');

      return matchInboundEmailToDispute(disputes ?? [], thread_id);
    });

    if (!matchedDispute) {
      // Forward to document ingestion pipeline
      await step.sendEvent('forward-to-ingestion', {
        name: 'email.unmatched',
        data: event.data,
      });
      return { matched: false };
    }

    // Step 2: Append inbound dispute_message
    await step.run('append-inbound-message', async () => {
      await supabase.from('dispute_messages').insert({
        org_id,
        dispute_id: matchedDispute.id,
        direction: 'inbound',
        from_email,
        to_emails,
        cc_emails: cc_emails ?? [],
        subject,
        body,
        email_message_id: message_id,
        email_thread_id: thread_id,
        sent_at: received_at,
      });
    });

    // Step 3: Update dispute status to carrier_replied
    await step.run('update-dispute-status', async () => {
      await supabase
        .from('disputes')
        .update({ status: 'carrier_replied', updated_at: new Date().toISOString() })
        .eq('id', matchedDispute.id)
        .eq('org_id', org_id);
    });

    // Step 4: Emit notification event (Plan 5 will handle this)
    await step.sendEvent('emit-notification', {
      name: 'notification.created',
      data: {
        org_id,
        type: 'carrier_replied',
        dispute_id: matchedDispute.id,
        message: `Carrier replied to your dispute`,
      },
    });

    return { matched: true, dispute_id: matchedDispute.id };
  }
);
```

```typescript
// app/api/inngest/route.ts
/**
 * Inngest webhook endpoint.
 * Registers all Inngest functions with the SDK.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { handleInboundEmail } from '@/lib/inngest/functions/handle-inbound-email';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [handleInboundEmail],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/inngest/handle-inbound-email.test.ts`
Expected: PASS

- [ ] **Step 5: Install Inngest SDK**

Run: `pnpm add inngest`

- [ ] **Step 6: Commit**

`git add lib/inngest/client.ts lib/inngest/functions/handle-inbound-email.ts app/api/inngest/route.ts && git commit -m "feat: Inngest inbound email handler matches carrier replies to disputes"`

---

### Task 9: Wire Dispute Panel into Invoice Detail

**Files:**
- Modify: existing Invoice Detail component (locate via `app/components/invoices/` or `app/`)
- Create: `app/components/disputes/DisputePanel.tsx` (orchestrator)
- Test: `tests/components/disputes/DisputePanel.test.tsx`

> Note: Before implementing, run `ls app/components/invoices/` and identify the invoice detail component to determine the exact file to modify. The dispute panel should be rendered in the right-hand panel of the invoice detail view, conditioned on dispute status.

---

- [ ] **Step 1: Write the failing test for the orchestrator**

```typescript
// tests/components/disputes/DisputePanel.test.tsx
import { render, screen } from '@testing-library/react';
import DisputePanel from '@/app/components/disputes/DisputePanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock API module
jest.mock('@/lib/api/disputes', () => ({
  fetchDisputeByInvoice: jest.fn(),
  fetchDisputeWithMessages: jest.fn(),
  createDraftDispute: jest.fn(),
}));

const { fetchDisputeByInvoice, fetchDisputeWithMessages } = require('@/lib/api/disputes');

const mockInvoice = {
  id: 'inv-1',
  invoice_number: 'INV-2024-001',
  carrier: { id: 'carrier-1', name_normalized: 'FastFreight', billing_email: null, billing_email_confirmed: false },
  findings: [{ id: 'f-1', summary: 'Rate mismatch', delta_amount: 125.50, amount_edited: null, is_approved: true }],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('DisputePanel', () => {
  it('shows "Start Dispute" when no dispute exists', async () => {
    fetchDisputeByInvoice.mockResolvedValue(null);

    render(
      <DisputePanel invoice={mockInvoice as any} />,
      { wrapper }
    );

    expect(await screen.findByRole('button', { name: /start dispute/i })).toBeInTheDocument();
  });

  it('shows draft panel header when dispute is in draft', async () => {
    fetchDisputeByInvoice.mockResolvedValue({
      id: 'dispute-1',
      status: 'draft',
      draft_letter: '',
      disputed_finding_ids: ['f-1'],
      total_disputed_amount: 125.50,
      recipient_email: null,
      recipient_name: null,
    });
    fetchDisputeWithMessages.mockResolvedValue({
      dispute: {
        id: 'dispute-1',
        status: 'draft',
        draft_letter: '',
        disputed_finding_ids: ['f-1'],
        total_disputed_amount: 125.50,
        recipient_email: null,
        recipient_name: null,
      },
      messages: [],
    });

    render(
      <DisputePanel invoice={mockInvoice as any} />,
      { wrapper }
    );

    expect(await screen.findByText(/dispute letter/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/disputes/DisputePanel.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the DisputePanel orchestrator**

```tsx
// app/components/disputes/DisputePanel.tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, AlertCircle } from 'lucide-react';
import type { Dispute } from '@/lib/api/disputes';
import {
  fetchDisputeByInvoice,
  fetchDisputeWithMessages,
  createDraftDispute,
} from '@/lib/api/disputes';
import DisputeDraftPanel from './DisputeDraftPanel';
import DisputeActivePanel from './DisputeActivePanel';
import BillingEmailConfirmModal from './BillingEmailConfirmModal';

interface InvoiceForDispute {
  id: string;
  invoice_number: string;
  carrier: {
    id: string;
    name_normalized: string;
    billing_email: string | null;
    billing_email_confirmed: boolean;
  };
  findings: Array<{
    id: string;
    summary: string;
    delta_amount: number;
    amount_edited: number | null;
    is_approved: boolean;
  }>;
}

interface DisputePanelProps {
  invoice: InvoiceForDispute;
}

export default function DisputePanel({ invoice }: DisputePanelProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [showBillingConfirm, setShowBillingConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Check if a dispute exists for this invoice
  const { data: disputeStub, isLoading: loadingStub } = useQuery({
    queryKey: ['dispute-by-invoice', invoice.id],
    queryFn: () => fetchDisputeByInvoice(invoice.id),
    staleTime: 30_000,
  });

  // Step 2: If dispute exists, fetch full detail with messages
  const { data: disputeDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['dispute-detail', disputeStub?.id],
    queryFn: () => fetchDisputeWithMessages(disputeStub!.id),
    enabled: !!disputeStub?.id,
    staleTime: 15_000,
  });

  const approvedFindings = invoice.findings.filter(f => f.is_approved);

  const handleCreateDispute = async () => {
    setCreating(true);
    setError(null);
    try {
      await createDraftDispute(
        invoice.id,
        approvedFindings.map(f => f.id)
      );
      queryClient.invalidateQueries({ queryKey: ['dispute-by-invoice', invoice.id] });
    } catch (e: any) {
      setError(e.message ?? 'Failed to start dispute');
    } finally {
      setCreating(false);
    }
  };

  const handleDisputeUpdated = (updated: Dispute) => {
    queryClient.setQueryData(['dispute-by-invoice', invoice.id], updated);
    queryClient.setQueryData(['dispute-detail', updated.id], (old: any) =>
      old ? { ...old, dispute: updated } : { dispute: updated, messages: [] }
    );
    // If status changed to sent/resolved, re-fetch messages
    if (['sent', 'carrier_replied', 'resolved'].includes(updated.status)) {
      queryClient.invalidateQueries({ queryKey: ['dispute-detail', updated.id] });
    }
  };

  const isLoading = loadingStub || (!!disputeStub && loadingDetail);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  // No dispute yet — show "Start Dispute" CTA
  if (!disputeStub) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-4">
        <FileText className="w-10 h-10 text-gray-300" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">No dispute opened yet</p>
          <p className="text-xs text-gray-500 mt-1">
            {approvedFindings.length} finding{approvedFindings.length !== 1 ? 's' : ''} approved
          </p>
        </div>
        <button
          onClick={handleCreateDispute}
          disabled={creating || approvedFindings.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? 'Starting…' : 'Start Dispute'}
        </button>
        {approvedFindings.length === 0 && (
          <p className="text-xs text-amber-600">Approve at least one finding to start a dispute.</p>
        )}
      </div>
    );
  }

  const dispute = disputeDetail?.dispute ?? disputeStub;
  const messages = disputeDetail?.messages ?? [];

  // Draft state
  if (dispute.status === 'draft') {
    return (
      <>
        <DisputeDraftPanel
          dispute={dispute}
          findings={invoice.findings}
          carrier={invoice.carrier}
          invoiceId={invoice.id}
          onDisputeUpdated={handleDisputeUpdated}
        />
        {showBillingConfirm && (
          <BillingEmailConfirmModal
            carrierName={invoice.carrier.name_normalized}
            billingEmail={invoice.carrier.billing_email ?? ''}
            onConfirm={async (confirmedEmail) => {
              // Save confirmed email to carrier (PATCH carrier route or PATCH dispute)
              await fetch(`/api/disputes/${dispute.id}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient_email: confirmedEmail }),
              });
              setShowBillingConfirm(false);
            }}
            onClose={() => setShowBillingConfirm(false)}
          />
        )}
      </>
    );
  }

  // Sent / carrier_replied / resolved state
  return (
    <DisputeActivePanel
      dispute={dispute}
      messages={messages}
      findings={invoice.findings}
      onDisputeUpdated={handleDisputeUpdated}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/disputes/DisputePanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire DisputePanel into Invoice Detail right panel**

In the invoice detail page/component (locate at `app/components/invoices/` or `app/[org]/invoices/[id]/page.tsx`):

```tsx
// Add import at the top of the invoice detail file:
import DisputePanel from '@/app/components/disputes/DisputePanel';

// In the right-hand panel JSX, add a Dispute tab or section:
// (The exact insertion point depends on the invoice detail layout — add below the findings list)
<section className="border-t border-gray-200 pt-4 mt-4">
  <h2 className="text-sm font-semibold text-gray-900 mb-3">Dispute</h2>
  <DisputePanel
    invoice={{
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      carrier: {
        id: invoice.carrier.id,
        name_normalized: invoice.carrier.name_normalized,
        billing_email: (invoice.carrier as any).billing_email ?? null,
        billing_email_confirmed: (invoice.carrier as any).billing_email_confirmed ?? false,
      },
      findings: invoice.findings.map((f: any) => ({
        id: f.id,
        summary: f.summary,
        delta_amount: f.delta_amount,
        amount_edited: f.amount_edited ?? null,
        is_approved: f.is_approved ?? false,
      })),
    }}
  />
</section>
```

- [ ] **Step 6: Commit**

`git add app/components/disputes/ && git commit -m "feat: wire DisputePanel orchestrator into Invoice Detail"`

---

## Integration Checklist

Before closing this plan, verify end-to-end:

- [ ] `POST /api/invoices/:id/disputes/create` creates a draft with `disputes.invoice_id` UNIQUE enforced
- [ ] `PATCH /api/disputes/:id` rejects edits when status is not `draft`
- [ ] `POST /api/disputes/:id/generate-letter` calls OpenAI and persists letter to DB
- [ ] `POST /api/disputes/:id/send` transitions `draft → sent`, appends `dispute_messages` row, stores `email_thread_id`
- [ ] `POST /api/disputes/:id/resolve` transitions to `resolved`, sets `invoices.ui_status = archived`
- [ ] Inbound email matching correctly sets `carrier_replied` status
- [ ] `BillingEmailConfirmModal` only appears when `carriers.billing_email_confirmed = false`
- [ ] `DisputeActivePanel` renders messages in immutable order; accepted findings are struck through in green
- [ ] Full test suite passes: `pnpm test`

---

## Final Commit

`git add -A && git commit -m "feat: complete dispute workflow — draft, send, carrier reply, resolve"`
