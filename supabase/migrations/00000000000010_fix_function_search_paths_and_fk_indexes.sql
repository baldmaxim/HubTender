-- Baseline migration 10/10: fix remaining function search_path warnings + add missed FK indexes.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).

-- =============================================================================
-- Fix function_search_path_mutable for 7 functions missed in migration 05.
-- Trigger functions and non-SECURITY DEFINER functions still need SET search_path.
-- Using dynamic SQL to handle signatures automatically.
-- =============================================================================

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'handle_updated_at',
              'auto_archive_tender_registry',
              'auto_create_tender_registry',
              'get_positions_with_costs',
              'trg_boq_items_update_grand_total',
              'trg_markup_pct_update_grand_total',
              'trg_subcontract_excl_update_grand_total'
          )
          AND NOT EXISTS (
              SELECT 1 FROM pg_options_to_table(p.proconfig)
              WHERE option_name = 'search_path'
          )
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp;', r.sig);
    END LOOP;
END $$;

-- =============================================================================
-- Remaining FK-gap indexes not covered in migration 04.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_boq_items_import_session_id ON public.boq_items(import_session_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_audit_changed_by ON public.boq_items_audit(changed_by);
CREATE INDEX IF NOT EXISTS idx_cost_redistribution_markup_tactic ON public.cost_redistribution_results(markup_tactic_id);
CREATE INDEX IF NOT EXISTS idx_import_sessions_tender_id ON public.import_sessions(tender_id);
CREATE INDEX IF NOT EXISTS idx_import_sessions_user_id ON public.import_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_library_folders_parent_id ON public.library_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_materials_library_folder_id ON public.materials_library(folder_id);
CREATE INDEX IF NOT EXISTS idx_project_additional_agreements_project_id ON public.project_additional_agreements(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_tender_id ON public.projects(tender_id);
CREATE INDEX IF NOT EXISTS idx_templates_folder_id ON public.templates(folder_id);
CREATE INDEX IF NOT EXISTS idx_tender_notes_user_id ON public.tender_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_tender_registry_construction_scope_id ON public.tender_registry(construction_scope_id);
CREATE INDEX IF NOT EXISTS idx_tender_registry_status_id ON public.tender_registry(status_id);
CREATE INDEX IF NOT EXISTS idx_user_position_filters_position_id ON public.user_position_filters(position_id);
CREATE INDEX IF NOT EXISTS idx_works_library_folder_id ON public.works_library(folder_id);
