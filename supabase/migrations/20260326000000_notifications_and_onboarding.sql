-- supabase/migrations/20260326000000_notifications_and_onboarding.sql

-- Add onboarding_completed to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false NOT NULL;

-- Notifications table (in-app only for MVP)
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       varchar(255) NOT NULL,
  body        text NOT NULL,
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  read        boolean DEFAULT false NOT NULL,
  created_at  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY['carrier_replied','invoice_ready','dispute_resolved'])
  )
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read, created_at DESC)
  WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_org_user
  ON public.notifications (org_id, user_id, created_at DESC);

-- Rate sheets: add status column for current vs superseded
ALTER TABLE public.rate_sheets
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'current' NOT NULL;
ALTER TABLE public.rate_sheets DROP CONSTRAINT IF EXISTS rate_sheets_status_check;
ALTER TABLE public.rate_sheets
  ADD CONSTRAINT rate_sheets_status_check CHECK (status = ANY (ARRAY['current','superseded']));
CREATE INDEX IF NOT EXISTS idx_rate_sheets_carrier_status
  ON public.rate_sheets (carrier_id, org_id, status);
