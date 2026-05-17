-- =============================================================================
-- 00_schemas.sql — schema namespaces for the cleaned Yandex Managed PostgreSQL
-- foundation.
--
-- Source of truth: supabase/migrations/ (NOT supabase/schemas/prod.sql).
-- See docs/yandex-migration/03_SCHEMA_STRATEGY.md and 07_SCHEMA_BUILD_REPORT.md.
--
-- RULES ENFORCED HERE:
--   * No Supabase-internal schemas are created here. Excluded on purpose:
--       realtime, storage, vault, graphql, supabase_migrations,
--       pgsodium, pg_net, extensions, _realtime, net.
--     Their objects (Supabase Realtime / Storage / GoTrue internals / PostgREST)
--     are NOT part of this foundation — Go BFF replaces them at runtime.
--   * No CREATE EXTENSION (pgcrypto / uuid-ossp are enabled at the Yandex
--     cluster level — see docs/yandex-migration/01_YANDEX_TARGET_INVENTORY.md §4
--     and the green YANDEX preflight).
--   * No CREATE ROLE / ALTER ROLE / ALTER SYSTEM / session_replication_role.
--   * No Supabase DB roles (anon / authenticated / service_role / authenticator).
--
-- `public` already exists in a stock PostgreSQL database; we only guarantee it.
-- `auth` is a thin compatibility bridge (see 01_auth_compat_or_app_auth.sql),
-- NOT Supabase GoTrue.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS public;

CREATE SCHEMA IF NOT EXISTS auth;

COMMENT ON SCHEMA auth IS
  'Compatibility bridge for the Yandex migration. Holds a minimal auth.users '
  'parent table (preserving bcrypt encrypted_password for a future Go app-auth '
  'migration) and an auth.uid() shim. This is NOT Supabase GoTrue. See '
  'docs/yandex-migration/04_AUTH_STRATEGY.md.';
