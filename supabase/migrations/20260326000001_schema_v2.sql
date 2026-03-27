-- =============================================================================
-- Sifter — Schema baseline + v2 extensions (idempotent)
--
-- Source of truth for legacy shape: supabase/v1-schema.sql
-- This file merges v1 columns/tables with v2 additions (rate_sheets, proof_clips,
-- disputes/dispute_messages, finding_type/source, RBAC-oriented memberships, etc.)
--
-- Run via: supabase db push  OR  psql $DATABASE_URL -f this_file
--
-- After CREATE TABLE IF NOT EXISTS, the "Upgrades" section below applies
-- ALTER TABLE changes so existing DBs (e.g. pure v1) gain missing columns,
-- renames, and expanded checks without requiring a manual one-off.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tenant
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by          uuid DEFAULT auth.uid(),
    name                character varying(255) NOT NULL,
    slug                character varying(100),
    plan                character varying(50) DEFAULT 'free' NOT NULL,
    billing_email       character varying(255),
    max_users           integer DEFAULT 5,
    max_leads           integer DEFAULT 1000,
    timezone            character varying(50) DEFAULT 'UTC',
    logo_url            text,
    website             text,
    created_at          timestamptz DEFAULT now() NOT NULL,
    updated_at          timestamptz DEFAULT now() NOT NULL,
    deleted_at          timestamptz,
    CONSTRAINT organizations_pkey PRIMARY KEY (id),
    CONSTRAINT organizations_plan_check CHECK (plan = ANY (ARRAY['free','pro','enterprise']))
);

CREATE TABLE IF NOT EXISTS public.users (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    email               character varying(255) NOT NULL,
    full_name           character varying(255),
    avatar_url          text,
    auth_provider       character varying(50),
    auth_provider_id    text,
    timezone            character varying(50) DEFAULT 'UTC',
    language            character varying(10) DEFAULT 'en',
    created_at          timestamptz DEFAULT now() NOT NULL,
    updated_at          timestamptz DEFAULT now() NOT NULL,
    last_login_at       timestamptz,
    deleted_at          timestamptz,
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.memberships (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id                  uuid NOT NULL,
    user_id                 uuid NOT NULL,
    role                    character varying(50) DEFAULT 'member' NOT NULL,
    status                  character varying(50) DEFAULT 'active',
    invited_by              uuid,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    can_manage_invoices     boolean DEFAULT true NOT NULL,
    can_view_findings       boolean DEFAULT true NOT NULL,
    can_manage_reports      boolean DEFAULT true NOT NULL,
    can_manage_mailboxes    boolean DEFAULT false NOT NULL,
    can_manage_organization boolean DEFAULT false NOT NULL,
    CONSTRAINT memberships_pkey PRIMARY KEY (id),
    CONSTRAINT memberships_org_fkey    FOREIGN KEY (org_id)    REFERENCES public.organizations (id),
    CONSTRAINT memberships_user_fkey   FOREIGN KEY (user_id)   REFERENCES public.users (id),
    CONSTRAINT memberships_role_check   CHECK (role   = ANY (ARRAY['owner','admin','manager','member','viewer'])),
    CONSTRAINT memberships_status_check CHECK (status = ANY (ARRAY['active','suspended','inactive','invited']))
);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user_uidx ON public.memberships (org_id, user_id);

-- ---------------------------------------------------------------------------
-- Booking (v1 — admin-booking OAuth)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_oauth_tokens (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    refresh_token   text NOT NULL,
    email           text,
    created_at      timestamptz DEFAULT now(),
    is_primary      boolean DEFAULT false,
    CONSTRAINT booking_oauth_tokens_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- Email connections & OAuth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_connections (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id          uuid NOT NULL,
    user_id         uuid NOT NULL,
    provider        text DEFAULT 'gmail' NOT NULL,
    email           text NOT NULL,
    status          text DEFAULT 'active' NOT NULL,
    last_sync_at    timestamptz,
    last_history_id text,
    last_error      text,
    created_at      timestamptz DEFAULT now() NOT NULL,
    updated_at      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT email_connections_pkey PRIMARY KEY (id),
    CONSTRAINT email_connections_provider_check CHECK (provider = ANY (ARRAY['gmail','outlook'])),
    CONSTRAINT email_connections_status_check   CHECK (status   = ANY (ARRAY['active','disconnected','error']))
);

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id           uuid NOT NULL,
    refresh_token_encrypted text NOT NULL,
    access_token_encrypted  text,
    expires_at              timestamptz,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_tokens_connection_fkey FOREIGN KEY (connection_id) REFERENCES public.email_connections (id)
);

CREATE TABLE IF NOT EXISTS public.oauth_sessions (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    state           text NOT NULL,
    code_verifier   text NOT NULL,
    code_challenge  text NOT NULL,
    user_id         uuid NOT NULL,
    org_id          uuid NOT NULL,
    status          text DEFAULT 'pending' NOT NULL,
    created_at      timestamptz DEFAULT now() NOT NULL,
    expires_at      timestamptz DEFAULT (now() + '00:10:00'::interval) NOT NULL,
    used_at         timestamptz,
    CONSTRAINT oauth_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT oauth_sessions_status_check CHECK (status = ANY (ARRAY['pending','used','expired']))
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.documents (
    id                          uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id                      uuid NOT NULL,
    source_type                 text NOT NULL,
    source_message_id           text,
    source_thread_id            text,
    source_attachment_id        text,
    filename                    text NOT NULL,
    mime_type                   text,
    file_size_bytes             bigint,
    gcs_key                     text NOT NULL,
    sha256                      text NOT NULL,
    document_type               text DEFAULT 'OTHER' NOT NULL,
    classification_confidence   numeric(3,2),
    classification_method       text,
    processing_status           text DEFAULT 'pending',
    mongodb_document_id         text,
    created_at                  timestamptz DEFAULT now() NOT NULL,
    updated_at                  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT documents_pkey PRIMARY KEY (id),
    CONSTRAINT documents_source_type_check CHECK (source_type = ANY (ARRAY['email','upload','api'])),
    CONSTRAINT documents_processing_status_check CHECK (processing_status = ANY (ARRAY['pending','processing','completed','failed'])),
    CONSTRAINT documents_classification_method_check CHECK (classification_method = ANY (ARRAY['ai','keyword','manual'])),
    CONSTRAINT documents_classification_confidence_check CHECK (classification_confidence BETWEEN 0 AND 1)
);

-- ---------------------------------------------------------------------------
-- Carriers & rate sheets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carriers (
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

CREATE TABLE IF NOT EXISTS public.rate_sheets (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id          uuid NOT NULL,
    carrier_id      uuid NOT NULL,
    document_id     uuid NOT NULL,
    effective_date  date,
    uploaded_at     timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT rate_sheets_pkey PRIMARY KEY (id),
    CONSTRAINT rate_sheets_carrier_fkey   FOREIGN KEY (carrier_id)   REFERENCES public.carriers (id),
    CONSTRAINT rate_sheets_document_fkey  FOREIGN KEY (document_id)  REFERENCES public.documents (id)
);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoices (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id                  uuid NOT NULL,
    document_id             uuid NOT NULL,
    carrier_id              uuid NOT NULL,
    connection_id           uuid,
    invoice_number          text NOT NULL,
    invoice_date            date NOT NULL,
    due_date                date,
    currency                text DEFAULT 'USD' NOT NULL,
    subtotal_amount         numeric(18,2),
    tax_amount              numeric(18,2),
    total_amount            numeric(18,2) NOT NULL,
    overcharge_amount       numeric(18,2) DEFAULT 0 NOT NULL,
    payment_terms_text      text,
    ui_status               text DEFAULT 'new' NOT NULL,
    confidence_overall      numeric(3,2),
    is_duplicate            boolean DEFAULT false NOT NULL,
    duplicate_of_invoice_id uuid,
    warnings                jsonb DEFAULT '[]' NOT NULL,
    total_processing_cost   numeric(12,6) DEFAULT 0,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT invoices_pkey PRIMARY KEY (id),
    CONSTRAINT invoices_document_fkey FOREIGN KEY (document_id) REFERENCES public.documents (id),
    CONSTRAINT invoices_carrier_fkey  FOREIGN KEY (carrier_id)  REFERENCES public.carriers (id),
    CONSTRAINT invoices_ui_status_check CHECK (ui_status = ANY (ARRAY[
        'new','no_findings','reviewing','action_needed','cleared','archived'
    ])),
    CONSTRAINT invoices_confidence_check CHECK (confidence_overall BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
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
    CONSTRAINT invoice_line_items_pkey PRIMARY KEY (id),
    CONSTRAINT invoice_line_items_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id)
);

CREATE TABLE IF NOT EXISTS public.invoice_references (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    invoice_id          uuid NOT NULL,
    ref_type            text NOT NULL,
    ref_value           text NOT NULL,
    related_document_id uuid,
    link_confidence     numeric(3,2) DEFAULT 1.0,
    link_method         text,
    created_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT invoice_references_pkey PRIMARY KEY (id),
    CONSTRAINT invoice_references_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT invoice_references_ref_type_check CHECK (ref_type = ANY (ARRAY['BOL','PRO','TRACKING','PO','LOAD','QUOTE','OTHER'])),
    CONSTRAINT invoice_references_link_confidence_check CHECK (link_confidence BETWEEN 0 AND 1)
);

-- ---------------------------------------------------------------------------
-- Findings (v1 leak_type → v2 finding_type; v1 disapproval_reason retained)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.findings (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    invoice_id          uuid NOT NULL,
    finding_type        text NOT NULL,
    rule_id             text NOT NULL,
    source              text NOT NULL,
    severity            text NOT NULL,
    expected_amount     numeric(18,2),
    charged_amount      numeric(18,2),
    delta_amount        numeric(18,2) NOT NULL,
    delta_percent       numeric(9,6),
    summary             text NOT NULL,
    reasoning           text NOT NULL,
    confidence          numeric(3,2),
    evidence_json       jsonb,
    description_edited  text,
    amount_edited       numeric(18,2),
    duplicate_invoice_id uuid,
    estimated_savings   numeric(18,2),
    proof_required      boolean DEFAULT false NOT NULL,
    proof_provided      boolean DEFAULT false NOT NULL,
    proof_type          text,
    required_proof_description text,
    is_approved         boolean DEFAULT false NOT NULL,
    approved_by         uuid,
    approved_at         timestamptz,
    disapproval_reason  text,
    created_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT findings_pkey PRIMARY KEY (id),
    CONSTRAINT findings_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT findings_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users (id),
    CONSTRAINT findings_finding_type_check CHECK (finding_type = ANY (ARRAY[
        'rate_mismatch','duplicate_invoice','math_error','fuel_surcharge',
        'detention','accessorial_without_proof','bol_mismatch',
        'late_submission','unit_mismatch','lumper_without_receipt'
    ])),
    CONSTRAINT findings_source_check   CHECK (source   = ANY (ARRAY['deterministic','ai_audit'])),
    CONSTRAINT findings_severity_check CHECK (severity = ANY (ARRAY['info','low','medium','high','critical'])),
    CONSTRAINT findings_confidence_check CHECK (confidence BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS public.finding_line_items (
    id           uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id       uuid NOT NULL,
    finding_id   uuid NOT NULL,
    line_item_id uuid NOT NULL,
    role         text NOT NULL,
    created_at   timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT finding_line_items_pkey PRIMARY KEY (id),
    CONSTRAINT finding_line_items_finding_fkey   FOREIGN KEY (finding_id)   REFERENCES public.findings (id),
    CONSTRAINT finding_line_items_line_item_fkey FOREIGN KEY (line_item_id) REFERENCES public.invoice_line_items (id),
    CONSTRAINT finding_line_items_role_check CHECK (role = ANY (ARRAY['expected','charged','discrepancy']))
);

CREATE TABLE IF NOT EXISTS public.proof_clips (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id      uuid NOT NULL,
    finding_id  uuid NOT NULL,
    gcs_key     text NOT NULL,
    source_doc  text NOT NULL,
    label       text,
    created_at  timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT proof_clips_pkey PRIMARY KEY (id),
    CONSTRAINT proof_clips_finding_fkey FOREIGN KEY (finding_id) REFERENCES public.findings (id),
    CONSTRAINT proof_clips_source_doc_check CHECK (source_doc = ANY (ARRAY['invoice','rate_sheet','bol']))
);

-- ---------------------------------------------------------------------------
-- Disputes — v2 normalized model
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.disputes (
    id                      uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id                  uuid NOT NULL,
    invoice_id              uuid NOT NULL,
    status                  text DEFAULT 'draft' NOT NULL,
    disputed_finding_ids    uuid[] DEFAULT '{}' NOT NULL,
    total_disputed_amount   numeric(18,2) DEFAULT 0 NOT NULL,
    draft_letter            text,
    recipient_email         text,
    recipient_name          text,
    email_thread_id         text,
    recovered_amount        numeric(18,2),
    resolved_at             timestamptz,
    created_at              timestamptz DEFAULT now() NOT NULL,
    updated_at              timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT disputes_pkey PRIMARY KEY (id),
    CONSTRAINT disputes_invoice_id_unique UNIQUE (invoice_id),
    CONSTRAINT disputes_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT disputes_status_check CHECK (status = ANY (ARRAY['draft','sent','carrier_replied','resolved']))
);

CREATE TABLE IF NOT EXISTS public.dispute_messages (
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
    has_attachments     boolean DEFAULT false,
    sent_at             timestamptz NOT NULL,
    created_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dispute_messages_pkey PRIMARY KEY (id),
    CONSTRAINT dispute_messages_dispute_fkey FOREIGN KEY (dispute_id) REFERENCES public.disputes (id),
    CONSTRAINT dispute_messages_direction_check CHECK (direction = ANY (ARRAY['outbound','inbound']))
);

-- ---------------------------------------------------------------------------
-- Dispute PDF + Gmail threads (v1 — still used by dispute generation UI)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dispute_documents (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    invoice_id          uuid NOT NULL,
    filename            text NOT NULL,
    gcs_key             text NOT NULL,
    file_size_bytes     bigint,
    status              text DEFAULT 'draft' NOT NULL,
    recipient_email     text,
    recipient_name      text,
    email_message_id    text,
    email_thread_id     text,
    email_sent_at       timestamptz,
    template_version    text DEFAULT 'v1',
    generated_findings  jsonb,
    created_by          uuid NOT NULL,
    created_at          timestamptz DEFAULT now() NOT NULL,
    updated_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dispute_documents_pkey PRIMARY KEY (id),
    CONSTRAINT dispute_documents_invoice_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices (id),
    CONSTRAINT dispute_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id),
    CONSTRAINT dispute_documents_status_check CHECK (status = ANY (ARRAY[
        'draft','generated','sent','acknowledged','resolved','cancelled'
    ]))
);

CREATE TABLE IF NOT EXISTS public.dispute_email_threads (
    id                  uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id              uuid NOT NULL,
    dispute_document_id uuid NOT NULL,
    gmail_thread_id     text NOT NULL,
    gmail_message_id    text NOT NULL,
    message_subject     text,
    message_from_email  text,
    message_from_name   text,
    message_to_emails   text[],
    message_cc_emails   text[],
    message_date        timestamptz NOT NULL,
    message_snippet     text,
    has_attachments     boolean DEFAULT false,
    direction           text NOT NULL,
    is_processed        boolean DEFAULT false,
    processed_at        timestamptz,
    created_at          timestamptz DEFAULT now() NOT NULL,
    updated_at          timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT dispute_email_threads_pkey PRIMARY KEY (id),
    CONSTRAINT dispute_email_threads_document_fkey FOREIGN KEY (dispute_document_id) REFERENCES public.dispute_documents (id),
    CONSTRAINT dispute_email_threads_direction_check CHECK (direction = ANY (ARRAY['sent','received']))
);

-- ---------------------------------------------------------------------------
-- Pipeline & observability
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cost_operations (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id          uuid NOT NULL,
    job_id          uuid NOT NULL,
    document_id     uuid,
    invoice_id      uuid,
    user_id         uuid,
    operation_type  character varying(50) NOT NULL,
    rule_id         character varying(100),
    model           character varying(100) NOT NULL,
    input_tokens    integer DEFAULT 0 NOT NULL,
    output_tokens   integer DEFAULT 0 NOT NULL,
    total_tokens    integer DEFAULT 0 NOT NULL,
    pages           integer,
    duration_seconds numeric(12,3),
    input_cost      numeric(12,6) DEFAULT 0 NOT NULL,
    output_cost     numeric(12,6) DEFAULT 0 NOT NULL,
    total_cost      numeric(12,6) NOT NULL,
    metadata        jsonb,
    created_at      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT cost_operations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.jobs (
    id              uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id          uuid NOT NULL,
    type            text NOT NULL,
    payload_json    jsonb NOT NULL,
    status          text DEFAULT 'queued' NOT NULL,
    attempts        integer DEFAULT 0 NOT NULL,
    max_attempts    integer DEFAULT 3 NOT NULL,
    next_run_at     timestamptz DEFAULT now(),
    error_message   text,
    sha256          text,
    created_at      timestamptz DEFAULT now() NOT NULL,
    updated_at      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT jobs_pkey PRIMARY KEY (id),
    CONSTRAINT jobs_status_check CHECK (status = ANY (ARRAY['queued','processing','succeeded','failed']))
);

-- =============================================================================
-- Upgrades: existing tables → target schema (safe to re-run where noted)
-- Covers typical v1 (supabase/v1-schema.sql) drift vs sections above.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS max_users integer DEFAULT 5,
    ADD COLUMN IF NOT EXISTS max_leads integer DEFAULT 1000;

-- ---------------------------------------------------------------------------
-- memberships — capability flags + role check (v1 already has flags; ADD IF NOT EXISTS for older DBs)
-- ---------------------------------------------------------------------------

ALTER TABLE public.memberships
    ADD COLUMN IF NOT EXISTS can_manage_invoices boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS can_view_findings boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS can_manage_reports boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS can_manage_mailboxes boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS can_manage_organization boolean DEFAULT false NOT NULL;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE public.memberships
    ADD CONSTRAINT memberships_role_check CHECK (
        role::text = ANY (ARRAY['owner','admin','manager','member','viewer'])
    );

-- ---------------------------------------------------------------------------
-- booking_oauth_tokens — v1 dump often had no primary key
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.booking_oauth_tokens'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE public.booking_oauth_tokens ADD CONSTRAINT booking_oauth_tokens_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- carriers
-- ---------------------------------------------------------------------------

ALTER TABLE public.carriers
    ADD COLUMN IF NOT EXISTS billing_email text,
    ADD COLUMN IF NOT EXISTS billing_email_confirmed boolean DEFAULT false;
UPDATE public.carriers SET billing_email_confirmed = COALESCE(billing_email_confirmed, false);
ALTER TABLE public.carriers ALTER COLUMN billing_email_confirmed SET DEFAULT false;
ALTER TABLE public.carriers ALTER COLUMN billing_email_confirmed SET NOT NULL;

-- ---------------------------------------------------------------------------
-- documents — document_type NOT NULL + default OTHER (v1 allowed NULL)
-- ---------------------------------------------------------------------------

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_type text DEFAULT 'OTHER';
UPDATE public.documents SET document_type = COALESCE(document_type, 'OTHER');
ALTER TABLE public.documents ALTER COLUMN document_type SET DEFAULT 'OTHER';
ALTER TABLE public.documents ALTER COLUMN document_type SET NOT NULL;

-- ---------------------------------------------------------------------------
-- invoices — v2 columns + expanded ui_status (adds no_findings)
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS overcharge_amount numeric(18,2) DEFAULT 0;
UPDATE public.invoices SET overcharge_amount = COALESCE(overcharge_amount, 0);
ALTER TABLE public.invoices ALTER COLUMN overcharge_amount SET DEFAULT 0;
ALTER TABLE public.invoices ALTER COLUMN overcharge_amount SET NOT NULL;

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false;
UPDATE public.invoices SET is_duplicate = COALESCE(is_duplicate, false);
ALTER TABLE public.invoices ALTER COLUMN is_duplicate SET DEFAULT false;
ALTER TABLE public.invoices ALTER COLUMN is_duplicate SET NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_ui_status_check;
ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_ui_status_check CHECK (
        ui_status = ANY (ARRAY['new','no_findings','reviewing','action_needed','cleared','archived'])
    );

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_confidence_overall_check;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_confidence_check;
ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_confidence_check CHECK (
        confidence_overall IS NULL OR (confidence_overall >= 0 AND confidence_overall <= 1)
    );

-- ---------------------------------------------------------------------------
-- findings — leak_type → finding_type; v2-only columns; NOT NULL alignment
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'findings' AND column_name = 'leak_type'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'findings' AND column_name = 'finding_type'
    ) THEN
        ALTER TABLE public.findings RENAME COLUMN leak_type TO finding_type;
    END IF;
END $$;

ALTER TABLE public.findings
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS description_edited text,
    ADD COLUMN IF NOT EXISTS amount_edited numeric(18,2),
    ADD COLUMN IF NOT EXISTS estimated_savings numeric(18,2),
    ADD COLUMN IF NOT EXISTS disapproval_reason text;

UPDATE public.findings SET source = COALESCE(source, 'deterministic');
ALTER TABLE public.findings ALTER COLUMN source SET DEFAULT 'deterministic';
ALTER TABLE public.findings ALTER COLUMN source SET NOT NULL;

UPDATE public.findings SET proof_required = COALESCE(proof_required, false);
UPDATE public.findings SET proof_provided = COALESCE(proof_provided, false);
UPDATE public.findings SET is_approved = COALESCE(is_approved, false);
ALTER TABLE public.findings ALTER COLUMN proof_required SET DEFAULT false;
ALTER TABLE public.findings ALTER COLUMN proof_provided SET DEFAULT false;
ALTER TABLE public.findings ALTER COLUMN is_approved SET DEFAULT false;
ALTER TABLE public.findings ALTER COLUMN proof_required SET NOT NULL;
ALTER TABLE public.findings ALTER COLUMN proof_provided SET NOT NULL;
ALTER TABLE public.findings ALTER COLUMN is_approved SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'findings_approved_by_fkey'
    ) THEN
        ALTER TABLE public.findings
            ADD CONSTRAINT findings_approved_by_fkey
            FOREIGN KEY (approved_by) REFERENCES public.users (id);
    END IF;
END $$;

ALTER TABLE public.findings DROP CONSTRAINT IF EXISTS findings_finding_type_check;
ALTER TABLE public.findings
    ADD CONSTRAINT findings_finding_type_check CHECK (
        finding_type = ANY (ARRAY[
            'rate_mismatch','duplicate_invoice','math_error','fuel_surcharge',
            'detention','accessorial_without_proof','bol_mismatch',
            'late_submission','unit_mismatch','lumper_without_receipt'
        ])
    );

ALTER TABLE public.findings DROP CONSTRAINT IF EXISTS findings_source_check;
ALTER TABLE public.findings
    ADD CONSTRAINT findings_source_check CHECK (source = ANY (ARRAY['deterministic','ai_audit']));

-- ---------------------------------------------------------------------------
-- dispute_documents / dispute_email_threads — FKs (v1 often had none)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_documents_pkey') THEN
        ALTER TABLE public.dispute_documents ADD CONSTRAINT dispute_documents_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_documents_invoice_fkey') THEN
        ALTER TABLE public.dispute_documents
            ADD CONSTRAINT dispute_documents_invoice_fkey
            FOREIGN KEY (invoice_id) REFERENCES public.invoices (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_documents_created_by_fkey') THEN
        ALTER TABLE public.dispute_documents
            ADD CONSTRAINT dispute_documents_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES public.users (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_email_threads_pkey') THEN
        ALTER TABLE public.dispute_email_threads ADD CONSTRAINT dispute_email_threads_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_email_threads_document_fkey') THEN
        ALTER TABLE public.dispute_email_threads
            ADD CONSTRAINT dispute_email_threads_document_fkey
            FOREIGN KEY (dispute_document_id) REFERENCES public.dispute_documents (id);
    END IF;
END $$;

ALTER TABLE public.dispute_documents DROP CONSTRAINT IF EXISTS dispute_documents_status_check;
ALTER TABLE public.dispute_documents
    ADD CONSTRAINT dispute_documents_status_check CHECK (
        status = ANY (ARRAY['draft','generated','sent','acknowledged','resolved','cancelled'])
    );
