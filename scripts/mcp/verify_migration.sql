\set ON_ERROR_STOP on
DO $$
DECLARE missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN missing := array_append(missing,'extension:pg_trgm'); END IF;
  IF to_regclass('app_auth.oauth_clients') IS NULL THEN missing := array_append(missing,'app_auth.oauth_clients'); END IF;
  IF to_regclass('app_auth.oauth_authorization_codes') IS NULL THEN missing := array_append(missing,'app_auth.oauth_authorization_codes'); END IF;
  IF to_regclass('app_auth.oauth_refresh_tokens') IS NULL THEN missing := array_append(missing,'app_auth.oauth_refresh_tokens'); END IF;
  IF to_regclass('app_auth.oauth_grants') IS NULL THEN missing := array_append(missing,'app_auth.oauth_grants'); END IF;
  IF to_regclass('public.pricing_drafts') IS NULL THEN missing := array_append(missing,'public.pricing_drafts'); END IF;
  IF to_regclass('public.pricing_draft_operations') IS NULL THEN missing := array_append(missing,'public.pricing_draft_operations'); END IF;
  IF to_regclass('public.pricing_draft_events') IS NULL THEN missing := array_append(missing,'public.pricing_draft_events'); END IF;
  IF to_regclass('public.boq_item_pricing_sources') IS NULL THEN missing := array_append(missing,'public.boq_item_pricing_sources'); END IF;
  IF cardinality(missing)>0 THEN RAISE EXCEPTION 'MCP migration incomplete: %',array_to_string(missing,', '); END IF;
END $$;
SELECT 'MCP_MIGRATION_OK' AS status,
       (SELECT count(*) FROM pg_indexes WHERE indexname IN ('material_names_name_trgm_idx','work_names_name_trgm_idx','client_positions_work_name_trgm_idx')) AS search_indexes;

