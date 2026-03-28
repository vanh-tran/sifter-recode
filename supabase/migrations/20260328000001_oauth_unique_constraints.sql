-- supabase/migrations/20260328000001_oauth_unique_constraints.sql
-- Required by the OAuth callback's storeConnection upserts.

ALTER TABLE public.email_connections
  DROP CONSTRAINT IF EXISTS email_connections_org_provider_email_key;

ALTER TABLE public.oauth_tokens
  DROP CONSTRAINT IF EXISTS oauth_tokens_connection_id_key;

ALTER TABLE public.email_connections
  ADD CONSTRAINT email_connections_org_provider_email_key
    UNIQUE (org_id, provider, email);

ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_connection_id_key
    UNIQUE (connection_id);
