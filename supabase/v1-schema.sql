CREATE TABLE public.booking_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refresh_token text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now(),
    is_primary boolean DEFAULT false
);


--
-- Name: carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name_raw text NOT NULL,
    name_normalized text NOT NULL,
    scac text,
    address_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cost_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    job_id uuid NOT NULL,
    document_id uuid,
    invoice_id uuid,
    user_id uuid,
    operation_type character varying(50) NOT NULL,
    rule_id character varying(100),
    model character varying(100) NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    pages integer,
    duration_seconds numeric(12,3),
    input_cost numeric(12,6) DEFAULT 0 NOT NULL,
    output_cost numeric(12,6) DEFAULT 0 NOT NULL,
    total_cost numeric(12,6) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dispute_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    filename text NOT NULL,
    gcs_key text NOT NULL,
    file_size_bytes bigint,
    status text DEFAULT 'draft'::text NOT NULL,
    recipient_email text,
    recipient_name text,
    email_message_id text,
    email_thread_id text,
    email_sent_at timestamp with time zone,
    template_version text DEFAULT 'v1'::text,
    generated_findings jsonb,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dispute_documents_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'generated'::text, 'sent'::text, 'acknowledged'::text, 'resolved'::text, 'cancelled'::text])))
);

--
-- Name: dispute_email_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_email_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    dispute_document_id uuid NOT NULL,
    gmail_thread_id text NOT NULL,
    gmail_message_id text NOT NULL,
    message_subject text,
    message_from_email text,
    message_from_name text,
    message_to_emails text[],
    message_cc_emails text[],
    message_date timestamp with time zone NOT NULL,
    message_snippet text,
    has_attachments boolean DEFAULT false,
    direction text NOT NULL,
    is_processed boolean DEFAULT false,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dispute_email_threads_direction_check CHECK ((direction = ANY (ARRAY['sent'::text, 'received'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    source_type text NOT NULL,
    source_message_id text,
    source_thread_id text,
    source_attachment_id text,
    filename text NOT NULL,
    mime_type text,
    file_size_bytes bigint,
    gcs_key text NOT NULL,
    sha256 text NOT NULL,
    processing_status text DEFAULT 'pending'::text,
    mongodb_document_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_type text DEFAULT 'OTHER'::text,
    classification_confidence numeric(3,2),
    classification_method text,
    CONSTRAINT documents_classification_confidence_check CHECK (((classification_confidence >= (0)::numeric) AND (classification_confidence <= (1)::numeric))),
    CONSTRAINT documents_classification_method_check CHECK ((classification_method = ANY (ARRAY['ai'::text, 'keyword'::text, 'manual'::text]))),
    CONSTRAINT documents_processing_status_check CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT documents_source_type_check CHECK ((source_type = ANY (ARRAY['email'::text, 'upload'::text, 'api'::text])))
);

--
-- Name: email_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'gmail'::text NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_sync_at timestamp with time zone,
    last_history_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_connections_provider_check CHECK ((provider = ANY (ARRAY['gmail'::text, 'outlook'::text]))),
    CONSTRAINT email_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disconnected'::text, 'error'::text])))
);

--
-- Name: finding_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finding_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    finding_id uuid NOT NULL,
    line_item_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT finding_line_items_role_check CHECK ((role = ANY (ARRAY['expected'::text, 'charged'::text, 'discrepancy'::text])))
);


--
-- Name: findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    leak_type text NOT NULL,
    rule_id text NOT NULL,
    severity text NOT NULL,
    expected_amount numeric(18,2),
    charged_amount numeric(18,2),
    delta_amount numeric(18,2) NOT NULL,
    delta_percent numeric(9,6),
    summary text NOT NULL,
    reasoning text NOT NULL,
    duplicate_invoice_id uuid,
    evidence_json jsonb,
    proof_required boolean DEFAULT false,
    proof_provided boolean DEFAULT false,
    proof_type text,
    required_proof_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confidence numeric(3,2),
    estimated_savings numeric(18,2),
    is_approved boolean DEFAULT false,
    approved_by uuid,
    approved_at timestamp with time zone,
    disapproval_reason text,
    CONSTRAINT findings_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT findings_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
);

--
-- Name: invoice_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    line_number integer,
    code text,
    description text NOT NULL,
    qty numeric(18,4),
    unit text,
    rate numeric(18,4),
    amount numeric(18,2) NOT NULL,
    charge_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: invoice_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    ref_type text NOT NULL,
    ref_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    related_document_id uuid,
    link_confidence numeric(3,2) DEFAULT 1.0,
    link_method text,
    CONSTRAINT invoice_references_link_confidence_check CHECK (((link_confidence >= (0)::numeric) AND (link_confidence <= (1)::numeric))),
    CONSTRAINT invoice_references_ref_type_check CHECK ((ref_type = ANY (ARRAY['BOL'::text, 'PRO'::text, 'TRACKING'::text, 'PO'::text, 'LOAD'::text, 'QUOTE'::text, 'OTHER'::text])))
);

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    document_id uuid NOT NULL,
    carrier_id uuid NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    due_date date,
    currency text DEFAULT 'USD'::text NOT NULL,
    subtotal_amount numeric(18,2),
    tax_amount numeric(18,2),
    total_amount numeric(18,2) NOT NULL,
    payment_terms_text text,
    ui_status text DEFAULT 'new'::text NOT NULL,
    confidence_overall numeric(3,2),
    duplicate_of_invoice_id uuid,
    is_duplicate boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    total_processing_cost numeric(12,6) DEFAULT 0,
    connection_id uuid,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT invoices_confidence_overall_check CHECK (((confidence_overall >= (0)::numeric) AND (confidence_overall <= (1)::numeric))),
    CONSTRAINT invoices_ui_status_check CHECK ((ui_status = ANY (ARRAY['new'::text, 'reviewing'::text, 'action_needed'::text, 'cleared'::text, 'archived'::text])))
);

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    type text NOT NULL,
    payload_json jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now(),
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sha256 text,
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text])))
);

--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) DEFAULT 'member'::character varying NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    can_manage_invoices boolean DEFAULT true NOT NULL,
    can_view_findings boolean DEFAULT true NOT NULL,
    can_manage_reports boolean DEFAULT true NOT NULL,
    can_manage_mailboxes boolean DEFAULT false NOT NULL,
    can_manage_organization boolean DEFAULT false NOT NULL,
    CONSTRAINT memberships_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'manager'::character varying, 'member'::character varying, 'viewer'::character varying])::text[]))),
    CONSTRAINT memberships_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'inactive'::character varying, 'invited'::character varying])::text[])))
);

--
-- Name: oauth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    code_verifier text NOT NULL,
    code_challenge text NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL,
    used_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT oauth_sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'expired'::text])))
);

CREATE TABLE public.oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connection_id uuid NOT NULL,
    refresh_token_encrypted text NOT NULL,
    access_token_encrypted text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    name character varying(255) NOT NULL,
    slug character varying(100),
    plan character varying(50) DEFAULT 'free'::character varying NOT NULL,
    billing_email character varying(255),
    max_users integer DEFAULT 5,
    max_leads integer DEFAULT 1000,
    timezone character varying(50) DEFAULT 'UTC'::character varying,
    logo_url text,
    website text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT organizations_plan_check CHECK (((plan)::text = ANY ((ARRAY['free'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[])))
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    full_name character varying(255),
    avatar_url text,
    auth_provider character varying(50),
    auth_provider_id text,
    timezone character varying(50) DEFAULT 'UTC'::character varying,
    language character varying(10) DEFAULT 'en'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    deleted_at timestamp with time zone
);