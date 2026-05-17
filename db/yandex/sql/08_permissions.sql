-- =============================================================================
-- 08_permissions.sql — runtime privilege model (DEFERRED / NO-OP here).
--
-- This file deliberately contains NO executable GRANT/REVOKE/ROLE statements.
-- Everything below is explanatory comments + a commented template.
--
-- WHY NO-OP NOW
-- -------------
--   * No Supabase DB roles exist on Yandex and they are NOT created here:
--     anon / authenticated / service_role / authenticator are Supabase-only.
--   * No CREATE ROLE / ALTER ROLE / ALTER SYSTEM (operator-managed at the
--     Yandex cluster level — see docs/yandex-migration/01_YANDEX_TARGET_INVENTORY.md §3).
--   * The migration user (e.g. `migrator`) owns the schema and already has all
--     privileges; the schema/data load needs no extra grants.
--   * The defence-in-depth runtime role (e.g. `hubtender_app`, SELECT/INSERT/
--     UPDATE/DELETE, no DDL) is created by the operator in Lockbox/console, not
--     by this SQL. Its grants are applied as a SEPARATE, explicit step once the
--     role exists and the cutover is authorised (05_CUTOVER_RULES.md).
--
-- DROPPED SUPABASE GRANT
-- ----------------------
--   PROD migration 14 ran `GRANT EXECUTE ON FUNCTION
--   public.save_redistribution_results(...) TO authenticated;`. That grant
--   targets a Supabase-only role and is intentionally NOT ported. On Yandex the
--   Go BFF connects as the runtime DB role; function execute is covered by the
--   template below (or PUBLIC default), not by a Supabase role grant.
--
-- FUTURE RUNTIME GRANT TEMPLATE (apply ONLY after the operator created the
-- runtime role and the cutover is authorised — replace :runtime_role):
--
--   -- GRANT USAGE ON SCHEMA public TO :runtime_role;
--   -- GRANT USAGE ON SCHEMA auth   TO :runtime_role;            -- bridge FKs/auth.uid()
--   -- GRANT SELECT, INSERT, UPDATE, DELETE
--   --   ON ALL TABLES IN SCHEMA public TO :runtime_role;
--   -- GRANT SELECT, INSERT, UPDATE, DELETE
--   --   ON ALL TABLES IN SCHEMA auth   TO :runtime_role;        -- users/identities bridge
--   -- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :runtime_role;
--   -- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :runtime_role;
--   -- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   --   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :runtime_role;
--   -- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   --   GRANT EXECUTE ON FUNCTIONS TO :runtime_role;
--   -- (NO DDL: do NOT grant CREATE/DROP/TRUNCATE to the runtime role.)
--
-- Nothing is executed by this file.
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE
    '08_permissions.sql: no-op. Runtime role grants are deferred until the '
    'operator-created runtime role exists and the cutover is authorised. '
    'See docs/yandex-migration/05_CUTOVER_RULES.md.';
END $$;
