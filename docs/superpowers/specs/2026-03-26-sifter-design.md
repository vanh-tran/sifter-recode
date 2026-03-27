# Sifter — MVP Design Spec

**Date:** 2026-03-26
**Status:** Approved

**Canonical schema (this repo):** [`docs/database/schema-v2.sql`](../../database/schema-v2.sql)

---

## 1. Product Overview

Sifter is an AI-powered freight invoice auditing SaaS for SMB companies. The primary user is an AP team member who currently rubber-stamps freight invoices without thorough review — because they lack the tools large corporations use to auto-detect overcharges.

**Core value proposition:** Invoices are audited *before* the AP team sits down to review them. Overcharges are flagged with evidence, disputes are drafted and ready to send — all from one app. The AP team goes from "approve everything" to "dispute what's wrong."

**Primary freight type:** FTL (Full Truckload).

**Hero user:** AP team member. Default views show work to be done, not analytics.

---

## 2. Architecture

### Storage
| Layer | Technology | What lives there |
|-------|-----------|------------------|
| Structured data | Supabase (Postgres) | All entities: orgs, invoices, findings, disputes, jobs |
| File storage | Google Cloud Storage (GCS) | Raw PDFs, rate sheets, BOLs, proof clip images |
| OCR intermediates | MongoDB | Raw OCR text, extraction intermediates |
| Job orchestration | Inngest | Durable step functions, retries, TypeScript SDK |

**Why Inngest over n8n:** More stable, built-in durable step functions, managed hosting, first-class TypeScript SDK.

### High-Level Data Flow
```
Email / Manual Upload
        ↓
   GCS (raw file)
        ↓
  Inngest Phase 1: OCR + Classify
        ↓
   Gate: abort if low parse quality
        ↓
  Inngest Phase 2: Normalize (LLM)
        ↓
  Supabase upsert + dedup check
        ↓
  Context gather: link BOLs + rate sheets
        ↓
  Fast (deterministic) checks
        ↓
  Audit Agent (AI)
        ↓
  Dedup findings → set invoice status
```

---

## 3. Email Intake

- **Sources:** Gmail OAuth, Outlook OAuth, manual PDF upload
- **Polling:** Every 15 minutes per connected mailbox
- **Backlog:** Historical emails processed automatically on first mailbox connection, going back `EMAIL_BACKLOG_DAYS` days (env var, default: 60)
- **Carrier extraction:** Carrier names and billing emails are auto-extracted from invoice emails during ingestion — no manual entry required

---

## 4. Audit Pipeline (detail)

### Phase 1 — OCR + Classify
- OCR the PDF; store raw text in MongoDB
- Classify: is this a freight invoice?
- Gate: abort pipeline if extraction quality too low (missing carrier name, invoice number, or total amount)

### Phase 2 — Normalize
- LLM extracts structured fields: carrier, invoice number, date, line items, totals, BOL/PRO numbers
- Upsert to `invoices` + `invoice_line_items` + `invoice_references` in Supabase
- Duplicate / near-duplicate detection (by invoice number + carrier + total)

### Context Gathering
- Link BOL documents to invoice via `invoice_references`
- Link rate sheet for the carrier (most recent by `effective_date`)

### Fast (Deterministic) Checks
These run first — cheap, rule-based:
- Math error (line items don't sum to total)
- Duplicate invoice (same invoice number + carrier already approved)
- Timestamp insanity (invoice date far in future or distant past)
- Unit mismatch (miles vs km, lbs vs kg)
- Late submission (invoice arrived beyond contractual window)

### Audit Agent (AI)
These require LLM reasoning against rate sheet / BOL:
- Rate mismatch vs contracted rate sheet
- BOL mismatch (shipped weight / route differs from billed)
- Fuel surcharge overcharge
- Detention charge without valid documentation
- Lumper charge without receipt
- Accessorial charge without proof

### Post-Audit
- Deduplicate findings (same issue flagged by both deterministic and AI → keep one)
- Set `invoices.ui_status` (see §6)
- Update `invoices.overcharge_amount` (denormalized sum of `findings.delta_amount`)

---

## 5. Schema

Full schema: [`docs/database/schema-v2.sql`](../../database/schema-v2.sql) (path from repository root). Key tables and decisions:

### Core Tables
- `organizations`, `users`, `memberships` — multi-tenant foundation
- `email_connections`, `oauth_tokens`, `oauth_sessions` — mailbox OAuth
- `documents` — every file entering the system (invoices, BOLs, rate sheets)
- `carriers` — auto-detected; includes `billing_email` + `billing_email_confirmed`
- `rate_sheets` — one per carrier per `effective_date`; most recent wins during audit
- `invoices` — includes `overcharge_amount` (denormalized) and `ui_status`
- `invoice_line_items`, `invoice_references` — parsed line items and BOL/PRO/PO refs
- `findings` — one row per identified issue; AI output is immutable
- `finding_line_items` — links findings to specific line items (expected vs charged)
- `proof_clips` — cropped PDF snippets surfaced as evidence in the UI
- `disputes` — one per invoice (UNIQUE on `invoice_id`); holds `draft_letter` and `disputed_finding_ids`
- `dispute_messages` — immutable log of every send and carrier reply
- `jobs`, `cost_operations` — pipeline observability and LLM cost tracking

### Key Schema Decisions
- **`memberships.can_*` columns removed:** RBAC is enforced in application code by role, not per-user boolean flags
- **`findings.description_edited` / `amount_edited`:** AP overrides are stored separately; AI output is never mutated
- **`disputes.disputed_finding_ids` (uuid[]):** AP's checkbox selections persist here; store model
- **`dispute_messages` is append-only:** Rows never updated after insert — immutable audit trail

---

## 6. Invoice Status

| Status | Meaning |
|--------|---------|
| `new` | Just ingested; pipeline not yet complete |
| `no_findings` | Pipeline complete; audit found no issues — AP should still review and clear |
| `action_needed` | Audit found overcharges; AP needs to review |
| `reviewing` | Dispute is open (draft or sent) |
| `cleared` | AP approved invoice; no dispute |
| `archived` | Manually archived or resolved |

---

## 7. RBAC

Permissions are hardcoded per role — no per-user permission toggles. The role picker (Admin/Member/Viewer) is the only control when inviting or editing a team member. Owner is assigned only to the org creator and cannot be reassigned in the UI.

| Permission | Owner | Admin | Member | Viewer |
|-----------|:-----:|:-----:|:------:|:------:|
| View invoices & findings | ✓ | ✓ | ✓ | ✓ |
| Manage invoices (status, approve) | ✓ | ✓ | ✓ | — |
| Create & send disputes | ✓ | ✓ | ✓ | — |
| Upload BOLs / rate sheets | ✓ | ✓ | ✓ | — |
| Manage carriers | ✓ | ✓ | — | — |
| Manage mailboxes | ✓ | ✓ | — | — |
| Invite / manage team | ✓ | ✓ | — | — |
| Org settings & billing | ✓ | — | — | — |

---

## 8. Findings Selection Model

AP checkboxes on the Invoice Detail page persist to `disputes.disputed_finding_ids` as the user ticks them (store model). Selections survive page refreshes, tab switches, and round-2 disputes.

**Audit re-run rule:** When the pipeline re-runs on an invoice and produces new findings, those new finding IDs are NOT auto-added to `disputed_finding_ids`. They start unchecked; AP must deliberately opt them in. Existing selections are untouched.

**Why:** AP may step away mid-review to check rate sheets. Interruptions must not reset work. In round 2, AP unchecks accepted findings rather than re-selecting everything from scratch.

---

## 9. Dispute Workflow

One active dispute per invoice (enforced by UNIQUE on `disputes.invoice_id`).

### State machine
```
[no dispute] → draft → sent → carrier_replied → resolved
                   ↑_____(can re-draft before sending)
```

### Draft state
- AI generates dispute letter from selected findings
- Recipient email auto-populated from `carriers.billing_email`
- AP can edit the letter freely and click Regenerate
- Findings panel on right: summary of checked findings, total disputed amount

### Active state (sent / carrier_replied)
- All sent letters and carrier replies are locked into `dispute_messages` (immutable)
- Carrier Replied: AP reads inbound reply, revises letter, selects remaining findings, resends
- Accepted findings: AP unchecks them; they appear struck through in green in round 2

### Sending
- Email sent from AP's own connected mailbox (not a Sifter system address)
- Each send appends a new `dispute_messages` row (direction = `outbound`)

### Resolution
- AP clicks "Mark Resolved" → enters recovered amount → dispute closes
- `disputes.recovered_amount` stored; feeds dashboard "Recovered (30d)" stat
- Invoice status → `archived`

### Carrier reply handling
- Inbound email matched to dispute via `disputes.email_thread_id`
- Reply appended to `dispute_messages` (direction = `inbound`)
- Dispute status → `carrier_replied`; row pinned to top in Disputes List

---

## 10. Notifications

**MVP:** In-app notifications only. AP team is in the app to process invoices; an in-app ping covers the core use case.

**Post-MVP:** Email notifications (carrier replied, new invoices ready for review).

---

## 11. Onboarding Flow

1. **Create account** — company name required; that's it
2. **Connect mailbox** — Gmail or Outlook OAuth (required step — no mailbox = no invoices). Carrier names and billing emails auto-extracted from first email batch; no manual entry. Backlog window: `EMAIL_BACKLOG_DAYS` days (default: 60).
3. **Upload rate sheets** — optional, skippable. Accuracy indicator shown: ~60% accuracy without rate sheets vs ~90% with.
4. **Upload BOLs** — optional, skippable
5. **Done** — pipeline starts; backlog processes in background (`EMAIL_BACKLOG_DAYS` days)

**First dispute gate:** Before the first dispute email is sent to a carrier, a one-time confirmation modal shows the extracted billing email. AP confirms or edits. Saved after that; not shown again for the same carrier.

---

## 12. UI Screens

### Dashboard
- **Stats bar:** Action Needed / Reviewing / Cleared / Overcharges Found (30d) / Recovered (30d)
- **Default tab:** Action Needed
- **Invoice list:** sorted by overcharge amount descending
- **Columns:** Carrier · Invoice # · Date · Total · Finding tags · Overcharge amount · Action button
- **Finding tags:** normalized categorical labels (e.g., "Rate Mismatch", "Duplicate"). No dollar amounts in tags — tags double as clickable filters. Dollar amounts appear in the Overcharge column.

### Invoice Detail
- **Header:** Carrier · Invoice # · Date · Total · Overcharge · BOL/PRO #
- **Left:** Original PDF viewer with "View original" link
- **Center:** Findings list as checkboxes. Each finding shows:
  - Finding type tag
  - AI-generated description (editable via pencil icon → saves to `description_edited`)
  - Dollar amount (editable via pencil icon → saves to `amount_edited`)
  - Proof clips: cropped PDF snippets with highlighted values
  - Edit note: "Changes saved to dispute draft only, not to AI output"
- **Right panel:** Invoice summary · Supporting docs · Dispute history · Dispute total · Open Dispute / Approve Invoice buttons

### Dispute — Draft State
- Recipient email (auto-detected, editable)
- AI-generated dispute letter (full text, editable)
- Regenerate button
- Right panel: findings summary, total disputed amount
- Send button → one-time billing email confirmation if first send to this carrier

### Dispute — Active State (sent / carrier_replied)
- Full dispute history log: each outbound send + inbound carrier reply, permanently locked
- Revised letter area for round 2
- Findings panel: accepted findings struck through in green
- "Mark Resolved" button → opens modal to enter recovered amount

### Disputes List
- **Stats bar:** Open · Draft · Sent — Awaiting Reply · Carrier Replied · Recovered (30d)
- **Tabs:** Active · Resolved · All
- **Carrier Replied rows:** pinned to top, orange left border, pulsing dot
- **Columns:** Carrier · Invoice # · Status badge · Disputed amount · Last activity · Open link
- No separate dispute detail page — "Open" navigates to Invoice Detail (dispute panel opens)

### Carriers Page
- Expandable cards per carrier (expand in-place, no separate detail page)
- **Collapsed:** Carrier icon · Name · SCAC · Invoice count · Billing email + confirmed/unconfirmed badge · Rate sheet status
- **Expanded:** Billing email editor (with Save button) · Rate sheet history (Current vs Superseded) + upload drop zone
- Footer note: "Carriers are auto-detected from your invoices. To merge or rename, contact support."

### Settings Page (3 tabs)

**Team tab:**
- Member list: avatar · name · email · role badge (Owner / Admin / Member / Viewer / Invited) · Remove action
- Invite form: email + role dropdown (Admin / Member / Viewer — Owner excluded)
- Pending invite rows with Revoke action

**Mailboxes tab:**
- Connected accounts: provider icon · email · status dot (active/error/disconnected) · last sync time · Disconnect button
- "Connect another mailbox" button

**Organization tab:**
- Org name (text field)
- Timezone (dropdown)

---

## 13. Out of Scope (Post-MVP)

- Email notifications (carrier replied, new invoices)
- Historical approved invoices as audit baseline
- TMS / EDI integrations
- Booking page (`booking_oauth_tokens` table — keep schema, implement later)
- Per-user permission toggles
- Carrier merge/rename in UI (support-only for MVP)
- Bulk dispute actions
- Export / reporting features

---

## 14. Open Questions / Future Considerations

None blocking MVP implementation.
