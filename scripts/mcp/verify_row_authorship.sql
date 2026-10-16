-- Read-only check after db/yandex/incremental/2026_10_mcp_row_authorship.sql.
-- Safe on production: no writes. Expected output: MCP_ROW_AUTHORSHIP_OK.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$
BEGIN
  IF to_regclass('public.client_position_gp_audit') IS NULL
     OR to_regprocedure('public.boq_audit_counts_as_authorship(text,text[],jsonb)') IS NULL
     OR to_regprocedure('public.boq_item_last_authorship(uuid)') IS NULL
     OR to_regprocedure('public.client_position_gp_last_authorship(uuid,text)') IS NULL
     OR to_regprocedure('public.copy_boq_item_authorship(uuid[],uuid[])') IS NULL
     OR to_regprocedure('public.copy_position_gp_authorship(uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'MCP_ROW_AUTHORSHIP_MISSING: run 2026_10_mcp_row_authorship.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.client_positions'::regclass
                   AND tgname = 'trg_client_positions_gp_audit' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'MCP_GP_AUDIT_TRIGGER_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                 WHERE proname = 'clone_tender_as_new_version'
                   AND prosrc LIKE '%copy_boq_item_authorship%') THEN
    RAISE EXCEPTION 'MCP_CLONE_AUTHORSHIP_MISSING: clone_tender_as_new_version is the old version';
  END IF;
  -- The withdrawn portal-wide ownership draft must not be installed.
  IF to_regclass('public.position_pricing_owners') IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_OWNERSHIP_DRAFT_INSTALLED: position_pricing_owners exists';
  END IF;
END $$;
SELECT 'MCP_ROW_AUTHORSHIP_OK' AS status,
       (SELECT count(*) FROM public.client_position_gp_audit) AS gp_journal_rows;
COMMIT;
