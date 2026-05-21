-- =============================================================================
-- 2026_05_app_auth_runtime.sql — Phase 6 app-auth MVP storage layer.
--
-- SCOPE: only adds app_auth schema + 3 tables (refresh_tokens,
-- password_reset_tokens, auth_events). No CREATE EXTENSION / CREATE ROLE /
-- ALTER ROLE / ALTER SYSTEM / session_replication_role / public-schema changes.
--
-- Password storage policy (MVP): bcrypt hashes remain in
-- auth.users.encrypted_password (already imported AS-IS from PROD). This file
-- does NOT create app_auth.password_credentials. Plaintext passwords and
-- plaintext tokens are NEVER stored — only opaque-token SHA-256 hashes.
--
-- Transaction wrapping is performed by the apply script (BEGIN/COMMIT live
-- outside this file, matching the convention of db/yandex/sql/*.sql).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app_auth;

COMMENT ON SCHEMA app_auth IS
  'Phase 6 Go-native app-auth runtime storage. Contains refresh-token rotation '
  'state, password-reset tokens and an auth-event audit log. Password hashes '
  'live in auth.users.encrypted_password (MVP); no app_auth.password_credentials '
  'until a later migration.';

-- ---------------------------------------------------------------------------
-- app_auth.refresh_tokens — rotation state for opaque refresh tokens.
--
-- token_hash = SHA-256 of the opaque token; the plaintext token NEVER leaves
-- the issuer-response path and is NEVER persisted. token_family_id groups
-- the rotation chain so that a single reuse-detection event can revoke the
-- whole family (replaced_by chains the rotation).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_auth.refresh_tokens (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      text        NOT NULL UNIQUE,
    token_family_id uuid        NOT NULL,
    issued_at       timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz NULL,
    replaced_by     uuid        NULL,
    user_agent      text        NULL,
    ip_address      inet        NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_auth_refresh_tokens_user_id      ON app_auth.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_app_auth_refresh_tokens_token_family ON app_auth.refresh_tokens (token_family_id);
CREATE INDEX IF NOT EXISTS idx_app_auth_refresh_tokens_expires_at   ON app_auth.refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_app_auth_refresh_tokens_revoked_at   ON app_auth.refresh_tokens (revoked_at);

COMMENT ON TABLE  app_auth.refresh_tokens                 IS 'Refresh tokens stored hashed only (SHA-256); plaintext tokens never persisted.';
COMMENT ON COLUMN app_auth.refresh_tokens.token_hash      IS 'SHA-256(opaque_token); never the plaintext token.';
COMMENT ON COLUMN app_auth.refresh_tokens.token_family_id IS 'Groups a rotation chain. Reuse detection revokes the whole family.';
COMMENT ON COLUMN app_auth.refresh_tokens.replaced_by     IS 'app_auth.refresh_tokens.id of the rotated successor (set on rotate). FK enforced at app layer for MVP.';

-- ---------------------------------------------------------------------------
-- app_auth.password_reset_tokens — single-use reset tokens.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_auth.password_reset_tokens (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    used_at      timestamptz NULL,
    user_agent   text        NULL,
    ip_address   inet        NULL
);

CREATE INDEX IF NOT EXISTS idx_app_auth_password_reset_tokens_user_id    ON app_auth.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_app_auth_password_reset_tokens_expires_at ON app_auth.password_reset_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_app_auth_password_reset_tokens_used_at    ON app_auth.password_reset_tokens (used_at);

COMMENT ON TABLE  app_auth.password_reset_tokens            IS 'Password-reset tokens stored hashed only (SHA-256); plaintext tokens never persisted.';
COMMENT ON COLUMN app_auth.password_reset_tokens.token_hash IS 'SHA-256(opaque_reset_token).';

-- ---------------------------------------------------------------------------
-- app_auth.auth_events — append-only audit log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_auth.auth_events (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ip_address inet        NULL,
    user_agent text        NULL,
    metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE  app_auth.auth_events            IS 'Append-only audit trail of auth lifecycle events. Plaintext passwords/tokens MUST never be written to metadata.';
COMMENT ON COLUMN app_auth.auth_events.event_type IS 'Free-form text (e.g. login_success, login_failed, refresh_rotated, refresh_reuse_detected, password_reset_requested, password_reset_used, logout).';
