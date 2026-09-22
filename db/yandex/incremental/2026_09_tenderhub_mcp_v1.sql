-- TenderHUB MCP v1: OAuth grants, auditable pricing drafts and archive search.
-- Apply on staging first. This migration is additive and idempotent.

BEGIN;

-- pg_trgm is required for indexed Russian archive-name search. On managed
-- PostgreSQL this statement intentionally fails closed when the extension is
-- not enabled for the cluster; do not silently deploy an unindexed fallback.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app_auth;

CREATE TABLE IF NOT EXISTS app_auth.oauth_clients (
    client_id text PRIMARY KEY,
    client_name text NOT NULL,
    redirect_uris jsonb NOT NULL,
    allowed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
    application_type text NOT NULL DEFAULT 'native',
    registration_kind text NOT NULL DEFAULT 'dynamic',
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_clients_redirect_uris_array CHECK (jsonb_typeof(redirect_uris) = 'array'),
    CONSTRAINT oauth_clients_application_type CHECK (application_type IN ('native', 'web')),
    CONSTRAINT oauth_clients_registration_kind CHECK (registration_kind IN ('dynamic', 'cimd', 'static'))
);

CREATE TABLE IF NOT EXISTS app_auth.oauth_authorization_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash text NOT NULL UNIQUE,
    client_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    redirect_uri text NOT NULL,
    scopes text[] NOT NULL,
    code_challenge text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_lookup_idx
    ON app_auth.oauth_authorization_codes (code_hash, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS app_auth.oauth_refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    token_family_id uuid NOT NULL,
    client_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    scopes text[] NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES app_auth.oauth_refresh_tokens(id),
    user_agent text,
    ip_address inet
);

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_client_idx
    ON app_auth.oauth_refresh_tokens (user_id, client_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS app_auth.oauth_grants (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    client_id text NOT NULL,
    scopes text[] NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.pricing_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES public.users(id),
    status text NOT NULL DEFAULT 'draft',
    base_revision timestamptz NOT NULL,
    validation_hash text,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    validated_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    applied_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pricing_drafts_status CHECK (status IN ('draft','ready','applied','cancelled','stale'))
);

CREATE INDEX IF NOT EXISTS pricing_drafts_tender_created_idx
    ON public.pricing_drafts (tender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pricing_drafts_user_status_idx
    ON public.pricing_drafts (created_by, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pricing_draft_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES public.pricing_drafts(id) ON DELETE CASCADE,
    action text NOT NULL,
    target_position_id uuid NOT NULL REFERENCES public.client_positions(id) ON DELETE CASCADE,
    target_item_id uuid REFERENCES public.boq_items(id) ON DELETE CASCADE,
    parent_operation_id uuid REFERENCES public.pricing_draft_operations(id),
    expected_etag text,
    proposed_payload jsonb NOT NULL,
    source_kind text NOT NULL,
    source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
    match_level text NOT NULL DEFAULT 'review',
    confidence numeric(5,4) NOT NULL DEFAULT 0,
    rationale text,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    position_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pricing_draft_operations_action CHECK (action IN ('create_item','update_item')),
    CONSTRAINT pricing_draft_operations_source CHECK (source_kind IN ('archive','library','template','manual')),
    CONSTRAINT pricing_draft_operations_match CHECK (match_level IN ('exact','strong','review','manual')),
    CONSTRAINT pricing_draft_operations_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS pricing_draft_operations_draft_idx
    ON public.pricing_draft_operations (draft_id, position_order, created_at);

CREATE TABLE IF NOT EXISTS public.pricing_draft_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES public.pricing_drafts(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES public.users(id),
    event_type text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_draft_events_draft_idx
    ON public.pricing_draft_events (draft_id, created_at);

CREATE TABLE IF NOT EXISTS public.boq_item_pricing_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_item_id uuid NOT NULL REFERENCES public.boq_items(id) ON DELETE CASCADE,
    draft_operation_id uuid NOT NULL REFERENCES public.pricing_draft_operations(id),
    source_kind text NOT NULL,
    source_tender_id uuid REFERENCES public.tenders(id) ON DELETE SET NULL,
    source_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
    source_template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL,
    source_rate numeric,
    source_currency text,
    source_date timestamptz,
    applied_by uuid NOT NULL REFERENCES public.users(id),
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boq_item_pricing_sources_item_idx
    ON public.boq_item_pricing_sources (boq_item_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS material_names_name_trgm_idx
    ON public.material_names USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS work_names_name_trgm_idx
    ON public.work_names USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS client_positions_work_name_trgm_idx
    ON public.client_positions USING gin (lower(work_name) gin_trgm_ops);

DROP TRIGGER IF EXISTS set_updated_at_oauth_clients ON app_auth.oauth_clients;
CREATE TRIGGER set_updated_at_oauth_clients
    BEFORE UPDATE ON app_auth.oauth_clients
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_pricing_drafts ON public.pricing_drafts;
CREATE TRIGGER set_updated_at_pricing_drafts
    BEFORE UPDATE ON public.pricing_drafts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_pricing_draft_operations ON public.pricing_draft_operations;
CREATE TRIGGER set_updated_at_pricing_draft_operations
    BEFORE UPDATE ON public.pricing_draft_operations
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
