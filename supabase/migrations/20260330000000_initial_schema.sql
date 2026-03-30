
-- =============================================================================
-- SECTION 2: CREATE TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tenant
-- ---------------------------------------------------------------------------

CREATE TABLE public.organizations (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by              uuid DEFAULT auth.uid(),
    name                    varchar(255) NOT NULL,
    slug                    varchar(100),
    plan                    varchar(50)  DEFAULT 'free' NOT NULL,
    billing_email           varchar(255),
    max_users               integer      DEFAULT 5,
    max_leads               integer      DEFAULT 1000,
    timezone                varchar(50)  DEFAULT 'UTC',
    logo_url                text,
    website                 text,
    onboarding_completed    boolean      DEFAULT false NOT NULL,
    created_at              timestamptz  DEFAULT now() NOT NULL,
    updated_at              timestamptz  DEFAULT now() NOT NULL,
    deleted_at              timestamptz,
    CONSTRAINT organizations_pkey       PRIMARY KEY (id),
    CONSTRAINT organizations_plan_check CHECK (plan = ANY (ARRAY['free','pro','enterprise']))
);

CREATE TABLE public.users (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    email               varchar(255) NOT NULL,
    full_name           varchar(255),
    avatar_url          text,
    auth_provider       varchar(50),
    auth_provider_id    text,
    timezone            varchar(50)  DEFAULT 'UTC',
    language            varchar(10)  DEFAULT 'en',
    created_at          timestamptz  DEFAULT now() NOT NULL,
    updated_at          timestamptz  DEFAULT now() NOT NULL,
    last_login_at       timestamptz,
    deleted_at          timestamptz,
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.memberships (
    id          uuid        DEFAULT gen_random_uuid() NOT NULL,
    org_id      uuid        NOT NULL,
    user_id     uuid        NOT NULL,
    role        varchar(50) DEFAULT 'member' NOT NULL,
    status      varchar(50) DEFAULT 'active',
    invited_by  uuid,
    created_at  timestamptz DEFAULT now() NOT NULL,
    updated_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT memberships_pkey         PRIMARY KEY (id),
    CONSTRAINT memberships_org_fkey     FOREIGN KEY (org_id)    REFERENCES public.organizations (id),
    CONSTRAINT memberships_user_fkey    FOREIGN KEY (user_id)   REFERENCES public.users (id),
    CONSTRAINT memberships_role_check   CHECK (role   = ANY (ARRAY['owner','admin','member','viewer'])),
    CONSTRAINT memberships_status_check CHECK (status = ANY (ARRAY['active','suspended','inactive','invited']))
);

CREATE UNIQUE INDEX memberships_org_user_uidx ON public.memberships (org_id, user_id);

-- ---------------------------------------------------------------------------
-- Email connections & OAuth
-- ---------------------------------------------------------------------------

CREATE TABLE public.email_connections (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id           uuid NOT NULL,
    user_id          uuid NOT NULL,
    provider         text DEFAULT 'gmail' NOT NULL,
    email            text NOT NULL,
    status           text DEFAULT 'active' NOT NULL,
    last_sync_at     timestamptz,
    last_history_id  text,
    last_error       text,
    created_at       timestamptz DEFAULT now() NOT NULL,
    updated_at       timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT email_connections_pkey                  PRIMARY KEY (id),
    CONSTRAINT email_connections_org_provider_email_key UNIQUE (org_id, provider, email),
    CONSTRAINT email_connections_provider_check        CHECK (provider = ANY (ARRAY['gmail','outlook'])),
    CONSTRAINT email_connections_status_check          CHECK (status   = ANY (ARRAY['active','disconnected','error']))
);

CREATE TABLE public.oauth_tokens (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id           uuid NOT NULL,
    refresh_token_encrypted text NOT NULL,
    access_token_encrypted  text,
    expires_at              timestamptz,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT oauth_tokens_pkey           PRIMARY KEY (id),
    CONSTRAINT oauth_tokens_connection_key UNIQUE (connection_id),
    CONSTRAINT oauth_tokens_connection_fkey FOREIGN KEY (connection_id) REFERENCES public.email_connections (id)
);

CREATE TABLE public.oauth_sessions (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    state           text NOT NULL,
    code_verifier   text NOT NULL,
    code_challenge  text NOT NULL,
    user_id         uuid NOT NULL,
    org_id          uuid NOT NULL,
    status          text DEFAULT 'pending' NOT NULL,
    created_at      timestamptz DEFAULT now() NOT NULL,
    expires_at      timestamptz DEFAULT (now() + interval '10 minutes') NOT NULL,
    used_at         timestamptz,
    CONSTRAINT oauth_sessions_pkey         PRIMARY KEY (id),
    CONSTRAINT oauth_sessions_status_check CHECK (status = ANY (ARRAY['pending','used','expired']))
);

-- ---------------------------------------------------------------------------
-- Documents (files in GCS — invoices, BOLs, rate sheets)
-- ---------------------------------------------------------------------------

CREATE TABLE public.documents (
    id                          uuid    DEFAULT gen_random_uuid() NOT NULL,
    org_id                      uuid    NOT NULL,
    source_type                 text    NOT NULL,
    source_message_id           text,
    source_thread_id            text,
    source_attachment_id        text,
    filename                    text    NOT NULL,
    mime_type                   text,
    file_size_bytes             bigint,
    gcs_key                     text    NOT NULL,
    sha256                      text    NOT NULL,
    document_type               text    DEFAULT 'OTHER' NOT NULL,
    classification_confidence   numeric(3,2),
    classification_method       text,
    processing_status           text    DEFAULT 'pending',
    mongodb_document_id         text,
    created_at                  timestamptz DEFAULT now() NOT NULL,
    updated_at                  timestamptz DEFAULT now() NOT NULL,
    extracted_refs              jsonb,
    CONSTRAINT documents_pkey                           PRIMARY KEY (id),
    CONSTRAINT documents_source_type_check              CHECK (source_type        = ANY (ARRAY['email','upload','api'])),
    CONSTRAINT documents_document_type_check            CHECK (document_type      = ANY (ARRAY['FREIGHT_INVOICE','BOL','RATE_SHEET','LUMPER_RECEIPT','DETENTION_NOTICE','OTHER'])),
    CONSTRAINT documents_processing_status_check        CHECK (processing_status  = ANY (ARRAY['pending','processing','rejected','failed','audited','re_auditing','completed'])),
    CONSTRAINT documents_classification_method_check    CHECK (classification_method = ANY (ARRAY['ai','keyword','manual'])),
    CONSTRAINT documents_classification_confidence_check CHECK (classification_confidence BETWEEN 0 AND 1)
);

-- ---------------------------------------------------------------------------
-- Email message batches (fan-in barrier for two-phase worker)
-- ---------------------------------------------------------------------------

CREATE TABLE public.email_message_batches (
    id                           uuid        DEFAULT gen_random_uuid() NOT NULL,
    org_id                       uuid        NOT NULL,
    source_message_id            text        NOT NULL,
    source_thread_id             text        NOT NULL,
    sibling_count                int         NOT NULL,
    phase1_done_count            int         DEFAULT 0 NOT NULL,
    freight_invoice_document_id  uuid,
    phase2_enqueued              boolean     DEFAULT false NOT NULL,
    created_at                   timestamptz DEFAULT now(),
    CONSTRAINT email_message_batches_pkey   PRIMARY KEY (id),
    CONSTRAINT email_message_batches_unique UNIQUE (org_id, source_message_id)
);

-- ---------------------------------------------------------------------------
-- Carriers & rate sheets
-- ---------------------------------------------------------------------------

CREATE TABLE public.carriers (
    id                          uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id                      uuid NOT NULL,
    name_raw                    text NOT NULL,
    name_normalized             text NOT NULL,
    scac                        text,
    address_json                jsonb,
    billing_email               text,
    billing_email_confirmed     boolean DEFAULT false NOT NULL,
    created_at                  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT carriers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.rate_sheets (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id          uuid NOT NULL,
    carrier_id      uuid NOT NULL,
    document_id     uuid NOT NULL,
    effective_date  date,
    status          text DEFAULT 'current' NOT NULL,
    uploaded_at     timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT rate_sheets_pkey          PRIMARY KEY (id),
    CONSTRAINT rate_sheets_carrier_fkey  FOREIGN KEY (carrier_id)  REFERENCES public.carriers (id),
    CONSTRAINT rate_sheets_document_fkey FOREIGN KEY (document_id) REFERENCES public.documents (id),
    CONSTRAINT rate_sheets_status_check  CHECK (status = ANY (ARRAY['current','superseded']))
);

CREATE INDEX idx_rate_sheets_carrier_status ON public.rate_sheets (carrier_id, org_id, status);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

CREATE TABLE public.invoices (
    id                      uuid        DEFAULT gen_random_uuid() NOT NULL,
    org_id                  uuid        NOT NULL,
    document_id             uuid        NOT NULL,
    carrier_id              uuid        NOT NULL,
    connection_id           uuid,
    invoice_number          text        NOT NULL,
    invoice_date            date        NOT NULL,
    due_date                date,
    currency                text        DEFAULT 'USD' NOT NULL,
    subtotal_amount         numeric(18,2),
    tax_amount              numeric(18,2),
    total_amount            numeric(18,2) NOT NULL,
    overcharge_amount       numeric(18,2) DEFAULT 0 NOT NULL,
    payment_terms_text      text,
    ui_status               text        DEFAULT 'new' NOT NULL,
    confidence_overall      numeric(3,2),
    is_duplicate            boolean     DEFAULT false NOT NULL,
    duplicate_of_invoice_id uuid,
    warnings                jsonb       DEFAULT '[]' NOT NULL,
    total_processing_cost   numeric(12,6) DEFAULT 0,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT invoices_pkey             PRIMARY KEY (id),
    CONSTRAINT invoices_document_fkey    FOREIGN KEY (document_id) REFERENCES public.documents (id),
    CONSTRAINT invoices_carrier_fkey     FOREIGN KEY (carrier_id)  REFERENCES public.carriers (id),
    CONSTRAINT invoices_ui_status_check  CHECK (ui_status = ANY (ARRAY[
        'new','no_findings','reviewing','action_needed','cleared','archived'
    ])),
    CONSTRAINT invoices_confidence_check CHECK (confidence_overall IS NULL OR confidence_overall BETWEEN 0 AND 1)
);

CREATE TABLE public.invoice_line_items (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id      uuid NOT NULL,
    invoice_id  uuid NOT NULL,
    line_number integer,
    code        text,
    description text NOT NULL,
    qty         numeric(18,4),
    unit        text,
    rate        numeric(18,4),
    amount      numeric(18,2) NOT NULL,
    charge_type text,
    created_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT invoice_line_items_pkey         PRIMARY KEY (id),
    CONSTRAINT invoice_line_items_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id)
);

CREATE TABLE public.invoice_references (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    invoice_id          uuid NOT NULL,
    ref_type            text NOT NULL,
    ref_value           text NOT NULL,
    related_document_id uuid,
    link_confidence     numeric(3,2) DEFAULT 1.0,
    link_method         text,
    created_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT invoice_references_pkey             PRIMARY KEY (id),
    CONSTRAINT invoice_references_invoice_fkey     FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT invoice_references_ref_type_check   CHECK (ref_type = ANY (ARRAY['BOL','PRO','TRACKING','PO','LOAD','QUOTE','OTHER'])),
    CONSTRAINT invoice_references_confidence_check CHECK (link_confidence BETWEEN 0 AND 1)
);

-- ---------------------------------------------------------------------------
-- Findings
-- ---------------------------------------------------------------------------

CREATE TABLE public.findings (
    id                          uuid          DEFAULT gen_random_uuid() NOT NULL,
    org_id                      uuid          NOT NULL,
    invoice_id                  uuid          NOT NULL,
    finding_type                text          NOT NULL,
    rule_id                     text          NOT NULL,
    source                      text          DEFAULT 'deterministic' NOT NULL,
    severity                    text          NOT NULL,
    expected_amount             numeric(18,2),
    charged_amount              numeric(18,2),
    delta_amount                numeric(18,2) NOT NULL,
    delta_percent               numeric(9,6),
    summary                     text          NOT NULL,
    reasoning                   text          NOT NULL,
    confidence                  numeric(3,2),
    evidence_json               jsonb,
    description_edited          text,
    amount_edited               numeric(18,2),
    duplicate_invoice_id        uuid,
    estimated_savings           numeric(18,2),
    proof_required              boolean       DEFAULT false NOT NULL,
    proof_provided              boolean       DEFAULT false NOT NULL,
    proof_type                  text,
    required_proof_description  text,
    is_approved                 boolean       DEFAULT false NOT NULL,
    approved_by                 uuid,
    approved_at                 timestamptz,
    disapproval_reason          text,
    created_at                  timestamptz   DEFAULT now() NOT NULL,
    CONSTRAINT findings_pkey              PRIMARY KEY (id),
    CONSTRAINT findings_invoice_fkey      FOREIGN KEY (invoice_id)  REFERENCES public.invoices (id),
    CONSTRAINT findings_approved_by_fkey  FOREIGN KEY (approved_by) REFERENCES public.users (id),
    CONSTRAINT findings_finding_type_check CHECK (finding_type = ANY (ARRAY[
        'rate_mismatch','duplicate_invoice','math_error','fuel_surcharge',
        'detention','accessorial_without_proof','bol_mismatch',
        'late_submission','unit_mismatch','lumper_without_receipt'
    ])),
    CONSTRAINT findings_source_check    CHECK (source   = ANY (ARRAY['deterministic','ai_audit'])),
    CONSTRAINT findings_severity_check  CHECK (severity = ANY (ARRAY['info','low','medium','high','critical'])),
    CONSTRAINT findings_confidence_check CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE TABLE public.finding_line_items (
    id           uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id       uuid NOT NULL,
    finding_id   uuid NOT NULL,
    line_item_id uuid NOT NULL,
    role         text NOT NULL,
    created_at   timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT finding_line_items_pkey          PRIMARY KEY (id),
    CONSTRAINT finding_line_items_finding_fkey  FOREIGN KEY (finding_id)   REFERENCES public.findings (id),
    CONSTRAINT finding_line_items_line_item_fkey FOREIGN KEY (line_item_id) REFERENCES public.invoice_line_items (id),
    CONSTRAINT finding_line_items_role_check    CHECK (role = ANY (ARRAY['expected','charged','discrepancy']))
);

CREATE TABLE public.proof_clips (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id      uuid NOT NULL,
    finding_id  uuid NOT NULL,
    gcs_key     text NOT NULL,
    source_doc  text NOT NULL,
    label       text,
    created_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT proof_clips_pkey             PRIMARY KEY (id),
    CONSTRAINT proof_clips_finding_fkey     FOREIGN KEY (finding_id) REFERENCES public.findings (id),
    CONSTRAINT proof_clips_source_doc_check CHECK (source_doc = ANY (ARRAY['invoice','rate_sheet','bol']))
);

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

CREATE TABLE public.disputes (
    id                      uuid          DEFAULT gen_random_uuid() NOT NULL,
    org_id                  uuid          NOT NULL,
    invoice_id              uuid          NOT NULL,
    status                  text          DEFAULT 'draft' NOT NULL,
    disputed_finding_ids    uuid[]        DEFAULT '{}' NOT NULL,
    total_disputed_amount   numeric(18,2) DEFAULT 0 NOT NULL,
    draft_letter            text,
    recipient_email         text,
    recipient_name          text,
    email_thread_id         text,
    recovered_amount        numeric(18,2),
    resolved_at             timestamptz,
    created_at              timestamptz   DEFAULT now() NOT NULL,
    updated_at              timestamptz   DEFAULT now() NOT NULL,
    CONSTRAINT disputes_pkey             PRIMARY KEY (id),
    CONSTRAINT disputes_invoice_id_unique UNIQUE (invoice_id),
    CONSTRAINT disputes_invoice_fkey     FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT disputes_status_check     CHECK (status = ANY (ARRAY['draft','sent','carrier_replied','resolved']))
);

CREATE TABLE public.dispute_messages (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    dispute_id          uuid NOT NULL,
    direction           text NOT NULL,
    from_email          text,
    to_emails           text[],
    cc_emails           text[],
    subject             text,
    body                text NOT NULL,
    email_message_id    text,
    email_thread_id     text,
    has_attachments     boolean     DEFAULT false,
    sent_at             timestamptz NOT NULL,
    created_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dispute_messages_pkey            PRIMARY KEY (id),
    CONSTRAINT dispute_messages_dispute_fkey    FOREIGN KEY (dispute_id) REFERENCES public.disputes (id),
    CONSTRAINT dispute_messages_direction_check CHECK (direction = ANY (ARRAY['outbound','inbound']))
);

-- ---------------------------------------------------------------------------
-- Pipeline & observability
-- ---------------------------------------------------------------------------

CREATE TABLE public.cost_operations (
    id               uuid         DEFAULT gen_random_uuid() NOT NULL,
    org_id           uuid         NOT NULL,
    job_id           uuid         NOT NULL,
    document_id      uuid,
    invoice_id       uuid,
    user_id          uuid,
    operation_type   varchar(50)  NOT NULL,
    rule_id          varchar(100),
    model            varchar(100) NOT NULL,
    input_tokens     integer      DEFAULT 0 NOT NULL,
    output_tokens    integer      DEFAULT 0 NOT NULL,
    total_tokens     integer      DEFAULT 0 NOT NULL,
    pages            integer,
    duration_seconds numeric(12,3),
    input_cost       numeric(12,6) DEFAULT 0 NOT NULL,
    output_cost      numeric(12,6) DEFAULT 0 NOT NULL,
    total_cost       numeric(12,6) NOT NULL,
    metadata         jsonb,
    created_at       timestamptz  DEFAULT now() NOT NULL,
    CONSTRAINT cost_operations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.jobs (
    id            uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id        uuid NOT NULL,
    type          text NOT NULL,
    payload_json  jsonb NOT NULL,
    status        text DEFAULT 'queued' NOT NULL,
    attempts      integer DEFAULT 0 NOT NULL,
    max_attempts  integer DEFAULT 3 NOT NULL,
    next_run_at   timestamptz DEFAULT now(),
    error_message text,
    sha256        text,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT jobs_pkey         PRIMARY KEY (id),
    CONSTRAINT jobs_status_check CHECK (status = ANY (ARRAY['queued','processing','succeeded','failed']))
);

-- ---------------------------------------------------------------------------
-- Notifications (in-app only for MVP)
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
    id          uuid         DEFAULT gen_random_uuid() NOT NULL,
    org_id      uuid         NOT NULL,
    user_id     uuid         NOT NULL,
    type        text         NOT NULL,
    title       varchar(255) NOT NULL,
    body        text         NOT NULL,
    invoice_id  uuid,
    read        boolean      DEFAULT false NOT NULL,
    created_at  timestamptz  DEFAULT now() NOT NULL,
    CONSTRAINT notifications_pkey       PRIMARY KEY (id),
    CONSTRAINT notifications_org_fkey   FOREIGN KEY (org_id)     REFERENCES public.organizations (id) ON DELETE CASCADE,
    CONSTRAINT notifications_user_fkey  FOREIGN KEY (user_id)    REFERENCES public.users (id) ON DELETE CASCADE,
    CONSTRAINT notifications_inv_fkey   FOREIGN KEY (invoice_id) REFERENCES public.invoices (id) ON DELETE SET NULL,
    CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['carrier_replied','invoice_ready','dispute_resolved']))
);

CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, read, created_at DESC) WHERE read = false;
CREATE INDEX idx_notifications_org_user    ON public.notifications (org_id, user_id, created_at DESC);

-- =============================================================================
-- SECTION 3: ROW LEVEL SECURITY
--
-- Pattern (from SECURITY_GUIDE.md):
--   All org-scoped tables use JWT claim: (auth.jwt() ->> 'org_id')::uuid = org_id
--   The org_id is embedded in the JWT at login via a custom access token hook —
--   no membership subquery per row. Fine-grained role enforcement (admin-only
--   actions, viewer restrictions) is handled in application code, not RLS.
--
--   Service-role tables: RLS enabled but NO policies → authenticated users
--   get zero rows. Service role bypasses RLS entirely.
--
--   Special cases:
--     organizations — id IS the org; compare against id, not org_id column.
--     users         — scoped by auth.uid() (own row) or service role for teammates.
--     notifications — scoped by user_id = auth.uid(), not org_id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_message_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carriers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_sheets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_references   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.findings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finding_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_clips          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_operations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- organizations
-- id IS the org_id — compare JWT claim against id, not a column named org_id.
-- INSERT is service role only (on signup).
-- ---------------------------------------------------------------------------

CREATE POLICY orgs_select ON public.organizations
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = id);

CREATE POLICY orgs_update ON public.organizations
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = id);

-- ---------------------------------------------------------------------------
-- users
-- Users read/update only their own row via auth.uid().
-- Teammate reads (team settings page) go through service role in server actions.
-- ---------------------------------------------------------------------------

CREATE POLICY users_select ON public.users
    FOR SELECT USING (id = auth.uid());

CREATE POLICY users_update ON public.users
    FOR UPDATE
    USING      (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------

CREATE POLICY memberships_select ON public.memberships
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY memberships_insert ON public.memberships
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY memberships_update ON public.memberships
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY memberships_delete ON public.memberships
    FOR DELETE USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- booking_oauth_tokens — service role only (no policies)
-- oauth_tokens        — service role only; tokens are KMS-encrypted, never client-exposed
-- oauth_sessions      — service role only; short-lived PKCE state
-- ---------------------------------------------------------------------------

-- (no policies on these three tables)

-- ---------------------------------------------------------------------------
-- email_connections
-- ---------------------------------------------------------------------------

CREATE POLICY email_connections_select ON public.email_connections
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY email_connections_insert ON public.email_connections
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY email_connections_update ON public.email_connections
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY email_connections_delete ON public.email_connections
    FOR DELETE USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

CREATE POLICY documents_select ON public.documents
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY documents_insert ON public.documents
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY documents_update ON public.documents
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- email_message_batches — service role only (worker reads/writes via service role)
-- ---------------------------------------------------------------------------

-- (no policies — service role bypasses RLS)

-- ---------------------------------------------------------------------------
-- carriers
-- ---------------------------------------------------------------------------

CREATE POLICY carriers_select ON public.carriers
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY carriers_insert ON public.carriers
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY carriers_update ON public.carriers
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- rate_sheets
-- ---------------------------------------------------------------------------

CREATE POLICY rate_sheets_select ON public.rate_sheets
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY rate_sheets_insert ON public.rate_sheets
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY rate_sheets_update ON public.rate_sheets
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- invoices
-- Pipeline inserts via service role. AP updates (status, approvals) via server client.
-- ---------------------------------------------------------------------------

CREATE POLICY invoices_select ON public.invoices
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY invoices_update ON public.invoices
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- invoice_line_items — read-only for authenticated users; pipeline writes via service role
-- ---------------------------------------------------------------------------

CREATE POLICY line_items_select ON public.invoice_line_items
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- invoice_references — read-only for authenticated users
-- ---------------------------------------------------------------------------

CREATE POLICY inv_refs_select ON public.invoice_references
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- findings
-- Pipeline inserts via service role. AP can update (edit description/amount).
-- ---------------------------------------------------------------------------

CREATE POLICY findings_select ON public.findings
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY findings_update ON public.findings
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- finding_line_items — read-only for authenticated users
-- proof_clips        — read-only for authenticated users
-- ---------------------------------------------------------------------------

CREATE POLICY finding_line_items_select ON public.finding_line_items
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY proof_clips_select ON public.proof_clips
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- disputes
-- ---------------------------------------------------------------------------

CREATE POLICY disputes_select ON public.disputes
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY disputes_insert ON public.disputes
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY disputes_update ON public.disputes
    FOR UPDATE
    USING      ((auth.jwt() ->> 'org_id')::uuid = org_id)
    WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- dispute_messages
-- ---------------------------------------------------------------------------

CREATE POLICY dispute_messages_select ON public.dispute_messages
    FOR SELECT USING ((auth.jwt() ->> 'org_id')::uuid = org_id);

CREATE POLICY dispute_messages_insert ON public.dispute_messages
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'org_id')::uuid = org_id);

-- ---------------------------------------------------------------------------
-- cost_operations — service role only (internal billing tracking)
-- jobs            — service role only (pipeline state)
-- ---------------------------------------------------------------------------

-- (no policies)

-- ---------------------------------------------------------------------------
-- notifications — user-scoped, not org-scoped
-- Users read and mark-read only their own. INSERT/DELETE via service role (fan-out).
-- ---------------------------------------------------------------------------

CREATE POLICY notifications_select ON public.notifications
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY notifications_update ON public.notifications
    FOR UPDATE
    USING      (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- SECTION 4: STORED PROCEDURES / RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- increment_batch_phase1
-- Atomically increments phase1_done_count; optionally sets freight_invoice_document_id
-- (uses COALESCE so first non-null doc id wins).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_batch_phase1(
  p_org_id                 uuid,
  p_source_message_id      text,
  p_freight_invoice_doc_id uuid DEFAULT NULL
) RETURNS SETOF public.email_message_batches AS $$
BEGIN
  RETURN QUERY
  UPDATE public.email_message_batches
  SET
    phase1_done_count           = phase1_done_count + 1,
    freight_invoice_document_id = COALESCE(freight_invoice_document_id, p_freight_invoice_doc_id)
  WHERE org_id            = p_org_id
    AND source_message_id = p_source_message_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- claim_phase2_enqueue
-- Atomic Phase 2 claim — flips phase2_enqueued to true and returns true only
-- once per batch (when all siblings are done and a freight invoice is linked).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_phase2_enqueue(
  p_org_id            uuid,
  p_source_message_id text
) RETURNS boolean AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE public.email_message_batches
  SET phase2_enqueued = true
  WHERE org_id            = p_org_id
    AND source_message_id = p_source_message_id
    AND phase2_enqueued   = false
    AND phase1_done_count >= sibling_count
    AND freight_invoice_document_id IS NOT NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$ LANGUAGE plpgsql;
