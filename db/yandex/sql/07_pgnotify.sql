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
-- Triggers fan out on: tenders, notifications, boq_items, client_positions,
-- cost_redistribution_results, construction_cost_volumes, tender_groups,
-- tender_iterations.
--
-- tender_iterations has no tender_id column — it is resolved via its group_id
-- → tender_groups.tender_id so the broker can route the event to tender:<id>
-- (see db/yandex/incremental/2026_06_timeline_pgnotify.sql).
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
