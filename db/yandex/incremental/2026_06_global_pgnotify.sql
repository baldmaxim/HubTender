-- =============================================================================
-- 2026_06_global_pgnotify.sql — realtime fan-out for global / reference tables.
--
-- SCOPE: adds pg_notify triggers on tables that are NOT tender-scoped, so the
-- Go BFF WebSocket hub can push live updates to dedicated global topics. These
-- tables previously had no triggers, so pages like Tasks / Users / Nomenclatures
-- / Library / MarkupConstructor / Projects / ImportLog / Bsm only refreshed on a
-- manual reload.
--
-- REQUIRES a matching backend change: backend/internal/realtime/broker.go must
-- map these table names to their global topics (user_tasks→tasks, users→users,
-- {materials,works}_library/{material,work}_names/units→references,
-- templates/template_items→templates, markup_{tactics,parameters}→markup,
-- import_sessions→imports, projects/project_*→projects,
-- tender_registry→tenders) and ws.go must authorise those topics.
-- Applying this migration BEFORE the new backend is safe: events for tables with
-- no tender_id are simply dropped by the old broker (warning log), not errored.
--
-- TWO trigger functions:
--   * public.notify_row_change()  — FOR EACH ROW, existing function. Used for
--     low-frequency tables where a per-row payload (id) is useful.
--   * public.notify_table_change() — FOR EACH STATEMENT, new. Used for tables
--     that are bulk-imported (materials/works libraries, names, units): a single
--     notify per statement instead of thousands per multi-row import. Payload
--     carries no row id; the `references` handler does an unconditional refetch
--     and never reads id, so this is lossless for the UI.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
-- Transaction wrapping (BEGIN/COMMIT) is performed by the apply script.
-- =============================================================================

-- Statement-level notifier for bulk-mutated reference tables.
CREATE OR REPLACE FUNCTION public.notify_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- No per-row data: one coalesced notify per statement. The broker routes by
    -- table name; the client refetches the whole list and ignores id/tender_id.
    PERFORM pg_notify('rowchange', jsonb_build_object(
        'table',     TG_TABLE_NAME,
        'op',        TG_OP,
        'id',        '',
        'tender_id', NULL,
        'user_id',   NULL
    )::text);
    RETURN NULL;  -- AFTER STATEMENT trigger: return value is ignored.
END;
$$;

-- ----- Row-level triggers (low-frequency global tables) ---------------------
DROP TRIGGER IF EXISTS trg_notify_row_change_user_tasks                   ON public.user_tasks;
DROP TRIGGER IF EXISTS trg_notify_row_change_users                        ON public.users;
DROP TRIGGER IF EXISTS trg_notify_row_change_templates                    ON public.templates;
DROP TRIGGER IF EXISTS trg_notify_row_change_template_items               ON public.template_items;
DROP TRIGGER IF EXISTS trg_notify_row_change_markup_tactics               ON public.markup_tactics;
DROP TRIGGER IF EXISTS trg_notify_row_change_markup_parameters            ON public.markup_parameters;
DROP TRIGGER IF EXISTS trg_notify_row_change_import_sessions              ON public.import_sessions;
DROP TRIGGER IF EXISTS trg_notify_row_change_projects                     ON public.projects;
DROP TRIGGER IF EXISTS trg_notify_row_change_project_additional_agreements ON public.project_additional_agreements;
DROP TRIGGER IF EXISTS trg_notify_row_change_project_monthly_completion    ON public.project_monthly_completion;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_registry              ON public.tender_registry;

CREATE TRIGGER trg_notify_row_change_user_tasks
    AFTER INSERT OR UPDATE OR DELETE ON public.user_tasks
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_users
    AFTER INSERT OR UPDATE OR DELETE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_templates
    AFTER INSERT OR UPDATE OR DELETE ON public.templates
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_template_items
    AFTER INSERT OR UPDATE OR DELETE ON public.template_items
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_markup_tactics
    AFTER INSERT OR UPDATE OR DELETE ON public.markup_tactics
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_markup_parameters
    AFTER INSERT OR UPDATE OR DELETE ON public.markup_parameters
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_import_sessions
    AFTER INSERT OR UPDATE OR DELETE ON public.import_sessions
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_projects
    AFTER INSERT OR UPDATE OR DELETE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_project_additional_agreements
    AFTER INSERT OR UPDATE OR DELETE ON public.project_additional_agreements
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_project_monthly_completion
    AFTER INSERT OR UPDATE OR DELETE ON public.project_monthly_completion
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_registry
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_registry
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

-- ----- Statement-level triggers (bulk-imported reference tables) ------------
DROP TRIGGER IF EXISTS trg_notify_table_change_materials_library ON public.materials_library;
DROP TRIGGER IF EXISTS trg_notify_table_change_works_library     ON public.works_library;
DROP TRIGGER IF EXISTS trg_notify_table_change_material_names    ON public.material_names;
DROP TRIGGER IF EXISTS trg_notify_table_change_work_names        ON public.work_names;
DROP TRIGGER IF EXISTS trg_notify_table_change_units             ON public.units;

CREATE TRIGGER trg_notify_table_change_materials_library
    AFTER INSERT OR UPDATE OR DELETE ON public.materials_library
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_table_change();

CREATE TRIGGER trg_notify_table_change_works_library
    AFTER INSERT OR UPDATE OR DELETE ON public.works_library
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_table_change();

CREATE TRIGGER trg_notify_table_change_material_names
    AFTER INSERT OR UPDATE OR DELETE ON public.material_names
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_table_change();

CREATE TRIGGER trg_notify_table_change_work_names
    AFTER INSERT OR UPDATE OR DELETE ON public.work_names
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_table_change();

CREATE TRIGGER trg_notify_table_change_units
    AFTER INSERT OR UPDATE OR DELETE ON public.units
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_table_change();
