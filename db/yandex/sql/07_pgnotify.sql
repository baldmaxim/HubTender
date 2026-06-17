-- =============================================================================
-- 07_pgnotify.sql — LISTEN/NOTIFY support for the Go BFF realtime hub.
--
-- Source: supabase/migrations/00000000000012_pgnotify_triggers.sql.
--
-- WHY THIS IS PRESERVED EXACTLY:
--   Go BFF replaced Supabase Realtime with a native WebSocket hub driven by
--   Postgres LISTEN/NOTIFY on channel `rowchange`. This MUST survive the Yandex
--   migration (docs/yandex-migration/03_SCHEMA_STRATEGY.md §8,
--   05_CUTOVER_RULES.md §9).
--
-- CHANNEL: `rowchange` (payload ~150 bytes, well under the 8 KB pg_notify limit).
-- The Supabase/PostgREST `pgrst` schema-reload channel is NOT ported (Go BFF
-- does not use it — see 03_SCHEMA_STRATEGY.md §9).
--
-- RUNTIME REQUIREMENT (not enforceable in SQL): the Go BFF realtime listener
-- must hold a DIRECT / session-safe connection. A transaction-pooler endpoint
-- breaks LISTEN/NOTIFY (05_CUTOVER_RULES.md §9; YANDEX_DIRECT_DATABASE_URL is
-- still an open warning for the final runtime cutover).
--
-- Triggers fan out on:
--   tender-scoped (→ tender:<tender_id>): tenders, boq_items, client_positions,
--     cost_redistribution_results, construction_cost_volumes, tender_groups,
--     tender_iterations, tender_markup_percentage, tender_pricing_distribution,
--     tender_insurance, tender_notes, tender_documents,
--     subcontract_growth_exclusions
--   per-user (→ notifications:<user_id>): notifications
--   global (→ dedicated topics, mapped by broker.topicsFor): user_tasks→tasks,
--     users→users, templates/template_items→templates,
--     markup_tactics/markup_parameters→markup, import_sessions→imports,
--     projects/project_additional_agreements/project_monthly_completion→projects,
--     tender_registry→tenders (reuses the tenders list topic)
--   bulk reference (statement-level → references): materials_library,
--     works_library, material_names, work_names, units
--
-- tender_iterations has no tender_id column — it is resolved via its group_id
-- → tender_groups.tender_id so the broker can route the event to tender:<id>
-- (see db/yandex/incremental/2026_06_timeline_pgnotify.sql). The global and
-- tender-scoped extensions live in db/yandex/incremental/2026_06_global_pgnotify.sql
-- and 2026_06_tender_scoped_pgnotify.sql; both are folded into this canonical file.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id        uuid;
    v_tender    uuid;
    v_user      uuid;
    v_payload   jsonb;
BEGIN
    -- Row id (for DELETE, NEW is NULL).
    v_id := COALESCE(NEW.id, OLD.id);

    -- tender_id selection by table.
    IF TG_TABLE_NAME = 'tenders' THEN
        v_tender := v_id;
    ELSIF TG_TABLE_NAME = 'notifications' THEN
        v_tender := NULL;
    ELSIF TG_TABLE_NAME = 'tender_iterations' THEN
        -- No tender_id column: resolve it through the parent group.
        SELECT tg.tender_id INTO v_tender
        FROM public.tender_groups tg
        WHERE tg.id = COALESCE(
            (CASE WHEN NEW IS NOT NULL THEN (to_jsonb(NEW)->>'group_id')::uuid END),
            (CASE WHEN OLD IS NOT NULL THEN (to_jsonb(OLD)->>'group_id')::uuid END)
        );
    ELSE
        -- boq_items, client_positions, cost_redistribution_results,
        -- construction_cost_volumes, tender_groups — all carry tender_id.
        v_tender := COALESCE(
            (CASE WHEN NEW IS NOT NULL THEN (to_jsonb(NEW)->>'tender_id')::uuid END),
            (CASE WHEN OLD IS NOT NULL THEN (to_jsonb(OLD)->>'tender_id')::uuid END)
        );
    END IF;

    -- user_id only on notifications.
    IF TG_TABLE_NAME = 'notifications' THEN
        v_user := COALESCE(
            (CASE WHEN NEW IS NOT NULL THEN (to_jsonb(NEW)->>'user_id')::uuid END),
            (CASE WHEN OLD IS NOT NULL THEN (to_jsonb(OLD)->>'user_id')::uuid END)
        );
    END IF;

    v_payload := jsonb_build_object(
        'table',     TG_TABLE_NAME,
        'op',        TG_OP,
        'id',        v_id,
        'tender_id', v_tender,
        'user_id',   v_user
    );

    -- pg_notify has an 8 KB payload limit; our payload is ~150 bytes.
    PERFORM pg_notify('rowchange', v_payload::text);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers. DROP first (idempotent re-run).
DROP TRIGGER IF EXISTS trg_notify_row_change_tenders                      ON public.tenders;
DROP TRIGGER IF EXISTS trg_notify_row_change_notifications                ON public.notifications;
DROP TRIGGER IF EXISTS trg_notify_row_change_boq_items                    ON public.boq_items;
DROP TRIGGER IF EXISTS trg_notify_row_change_client_positions             ON public.client_positions;
DROP TRIGGER IF EXISTS trg_notify_row_change_cost_redistribution_results  ON public.cost_redistribution_results;
DROP TRIGGER IF EXISTS trg_notify_row_change_construction_cost_volumes    ON public.construction_cost_volumes;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_groups                ON public.tender_groups;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_iterations            ON public.tender_iterations;

CREATE TRIGGER trg_notify_row_change_tenders
    AFTER INSERT OR UPDATE OR DELETE ON public.tenders
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_notifications
    AFTER INSERT OR UPDATE OR DELETE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_boq_items
    AFTER INSERT OR UPDATE OR DELETE ON public.boq_items
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_client_positions
    AFTER INSERT OR UPDATE OR DELETE ON public.client_positions
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_cost_redistribution_results
    AFTER INSERT OR UPDATE OR DELETE ON public.cost_redistribution_results
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_construction_cost_volumes
    AFTER INSERT OR UPDATE OR DELETE ON public.construction_cost_volumes
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_groups
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_groups
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_iterations
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_iterations
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

-- =============================================================================
-- Tender-scoped extension (db/yandex/incremental/2026_06_tender_scoped_pgnotify.sql)
-- These tables carry tender_id directly → generic branch routes to tender:<id>.
-- =============================================================================
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_markup_percentage      ON public.tender_markup_percentage;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_pricing_distribution   ON public.tender_pricing_distribution;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_insurance              ON public.tender_insurance;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_notes                  ON public.tender_notes;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_documents              ON public.tender_documents;
DROP TRIGGER IF EXISTS trg_notify_row_change_subcontract_growth_exclusions ON public.subcontract_growth_exclusions;

CREATE TRIGGER trg_notify_row_change_tender_markup_percentage
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_markup_percentage
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_pricing_distribution
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_pricing_distribution
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_insurance
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_insurance
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_notes
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_notes
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_documents
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_documents
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_subcontract_growth_exclusions
    AFTER INSERT OR UPDATE OR DELETE ON public.subcontract_growth_exclusions
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

-- =============================================================================
-- Global / reference extension (db/yandex/incremental/2026_06_global_pgnotify.sql)
-- Row-level for low-frequency tables; statement-level for bulk-imported ones.
-- Routed by broker.topicsFor to dedicated global topics.
-- =============================================================================

-- Statement-level notifier for bulk-mutated reference tables.
CREATE OR REPLACE FUNCTION public.notify_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM pg_notify('rowchange', jsonb_build_object(
        'table',     TG_TABLE_NAME,
        'op',        TG_OP,
        'id',        '',
        'tender_id', NULL,
        'user_id',   NULL
    )::text);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_row_change_user_tasks                    ON public.user_tasks;
DROP TRIGGER IF EXISTS trg_notify_row_change_users                         ON public.users;
DROP TRIGGER IF EXISTS trg_notify_row_change_templates                     ON public.templates;
DROP TRIGGER IF EXISTS trg_notify_row_change_template_items                ON public.template_items;
DROP TRIGGER IF EXISTS trg_notify_row_change_markup_tactics                ON public.markup_tactics;
DROP TRIGGER IF EXISTS trg_notify_row_change_markup_parameters             ON public.markup_parameters;
DROP TRIGGER IF EXISTS trg_notify_row_change_import_sessions               ON public.import_sessions;
DROP TRIGGER IF EXISTS trg_notify_row_change_projects                      ON public.projects;
DROP TRIGGER IF EXISTS trg_notify_row_change_project_additional_agreements ON public.project_additional_agreements;
DROP TRIGGER IF EXISTS trg_notify_row_change_project_monthly_completion    ON public.project_monthly_completion;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_registry               ON public.tender_registry;

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
