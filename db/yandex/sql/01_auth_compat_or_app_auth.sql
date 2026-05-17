-- =============================================================================
-- 01_auth_compat_or_app_auth.sql — minimal auth-compatibility bridge.
--
-- STRATEGY (decided for this foundation — see 07_SCHEMA_BUILD_REPORT.md §Auth):
--   Option A "minimal auth.users compatibility table" from
--   docs/yandex-migration/03_SCHEMA_STRATEGY.md §4–5.
--
--   * Yandex Managed PostgreSQL has NO GoTrue. We do NOT run Supabase Auth.
--   * Several public tables historically FK to auth.users(id). To import the
--     PROD Supabase snapshot byte-for-byte WITHOUT rewriting every FK yet, we
--     keep a THIN auth.users parent table.
--   * encrypted_password (bcrypt) is preserved AS-IS so a later, separate stage
--     can migrate it into app_auth.password_credentials (Option B). Password
--     hashes are never rehashed and never logged.
--   * GoTrue sessions / refresh_tokens are deliberately NOT modelled — they are
--     not a runtime dependency (users log in again after the auth cutover; see
--     docs/yandex-migration/04_AUTH_STRATEGY.md §5–6).
--   * app_auth.password_credentials is OUT OF SCOPE for this prompt; it is a
--     follow-up stage after this schema foundation.
--
-- This file contains NO CREATE ROLE / GRANT TO Supabase roles / CREATE EXTENSION.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- auth.uid() compatibility shim.
--
-- Supabase resolves the current user from the JWT via auth.uid(). On Yandex
-- there is no GoTrue/JWT-in-Postgres. Access control is enforced by the Go BFF
-- at the application layer. SQL functions / future defence-in-depth that still
-- reference auth.uid() resolve the user id from a session GUC instead:
--
--   * app.user_id          — forward-looking name used by the Go BFF cutover
--   * app.current_user_id  — already set/cleared by public.set_audit_user() /
--                            public.clear_audit_user() (kept from PROD)
--
-- Returns NULL safely when neither GUC is set (missing_ok = true), so audit /
-- privilege functions degrade to "no user" rather than erroring.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT NULLIF(
           COALESCE(
             NULLIF(current_setting('app.user_id',          true), ''),
             NULLIF(current_setting('app.current_user_id',   true), '')
           ),
           ''
         )::uuid;
$$;

COMMENT ON FUNCTION auth.uid() IS
  'Compatibility shim (NOT Supabase GoTrue). Resolves the acting user id from '
  'the app.user_id / app.current_user_id session GUC set by the Go BFF. '
  'Returns NULL when unset. See docs/yandex-migration/04_AUTH_STRATEGY.md.';

-- ---------------------------------------------------------------------------
-- auth.users — minimal compatibility / FK-parent table.
--
-- Column set is a pragmatic superset chosen so the PROD Supabase auth.users
-- snapshot imports cleanly later (the prototype exporter projects exactly:
-- id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
-- raw_app_meta_data, role, phone, phone_confirmed_at, created_at, updated_at,
-- last_sign_in_at, banned_until, deleted_at, is_sso_user, is_anonymous —
-- see scripts/old-to-prod/_auth.mjs) PLUS the GoTrue NOT-NULL token columns
-- (default '' to mirror PROD's repaired state — see
-- scripts/old-to-prod/_mapping.mjs AUTH_USERS_NOT_NULL_TOKENS).
--
-- This is a BRIDGE, not GoTrue: no triggers, no auth state machine, no email
-- flows. `id` is the FK parent for public.users.id and *_created_by / user_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
    id                          uuid        NOT NULL,
    email                       text,
    encrypted_password          text,                       -- bcrypt, AS-IS, never logged/rehashed
    email_confirmed_at          timestamptz,
    phone                       text,
    phone_confirmed_at          timestamptz,
    raw_app_meta_data           jsonb       DEFAULT '{}'::jsonb,
    raw_user_meta_data          jsonb       DEFAULT '{}'::jsonb,
    role                        text,                        -- GoTrue data value (e.g. 'authenticated'); a column, NOT a DB role
    aud                         text,
    last_sign_in_at             timestamptz,
    banned_until                timestamptz,
    deleted_at                  timestamptz,
    is_sso_user                 boolean     NOT NULL DEFAULT false,
    is_anonymous                boolean     NOT NULL DEFAULT false,
    -- GoTrue NOT-NULL token/change string columns (PROD repaired NULL -> '').
    confirmation_token          text        DEFAULT ''::text,
    recovery_token              text        DEFAULT ''::text,
    email_change_token_new      text        DEFAULT ''::text,
    email_change_token_current  text        DEFAULT ''::text,
    email_change                text        DEFAULT ''::text,
    reauthentication_token      text        DEFAULT ''::text,
    phone_change                text        DEFAULT ''::text,
    phone_change_token          text        DEFAULT ''::text,
    created_at                  timestamptz DEFAULT now(),
    updated_at                  timestamptz DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE auth.users IS
  'BRIDGE table (Option A) — minimal FK parent for public FKs and preserved '
  'bcrypt encrypted_password for a later Go app-auth migration. NOT Supabase '
  'GoTrue; no sessions/refresh tokens/email flows.';

-- ---------------------------------------------------------------------------
-- auth.identities — optional compatibility table.
--
-- Kept ONLY for import/verify parity with the PROD Supabase snapshot
-- (scripts/old-to-prod/_auth.mjs projects: id, provider_id, user_id,
-- identity_data, provider, last_sign_in_at, created_at, updated_at). The
-- generated `email` column mirrors Supabase Auth >= 2023.5
-- (GENERATED ALWAYS AS lower(identity_data->>'email') STORED) so the auth
-- verify drift-check passes. Not a runtime dependency.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.identities (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    provider_id     text        NOT NULL,
    user_id         uuid        NOT NULL,
    identity_data   jsonb       NOT NULL,
    provider        text        NOT NULL,
    email           text        GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
    last_sign_in_at timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    CONSTRAINT identities_pkey PRIMARY KEY (id),
    CONSTRAINT identities_provider_id_provider_key UNIQUE (provider, provider_id),
    CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE CASCADE
);

COMMENT ON TABLE auth.identities IS
  'Compatibility table for PROD Supabase auth.identities import/verify parity. '
  'Optional bridge — not a Yandex runtime dependency.';

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth.identities(user_id);
