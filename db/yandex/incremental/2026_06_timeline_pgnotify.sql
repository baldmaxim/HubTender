-- =============================================================================
-- 2026_06_timeline_pgnotify.sql — realtime fan-out for the TenderTimeline page.
--
-- SCOPE: extends public.notify_row_change() and adds pg_notify triggers on
-- public.tender_groups and public.tender_iterations so the Go BFF WebSocket hub
-- pushes live updates to the `tender:<tender_id>` topic when timeline rows
-- change (создание/ответ по записи, оценка качества). Previously these two
-- tables had NO triggers, so other viewers saw new records only after a manual
-- reload (см. план, Задача №1, фикс B).
--
-- tender_iterations has no tender_id column → it is resolved through its parent
-- group (group_id → tender_groups.tender_id). tender_groups carries tender_id
-- directly and falls into the generic branch.
--
-- This is the live-DB counterpart of the canonical db/yandex/sql/07_pgnotify.sql.
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
--
-- Transaction wrapping (BEGIN/COMMIT) is performed by the apply script,
-- matching the convention of db/yandex/sql/*.sql.
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

-- Attach triggers on the two timeline tables (idempotent re-run).
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_groups     ON public.tender_groups;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_iterations ON public.tender_iterations;

CREATE TRIGGER trg_notify_row_change_tender_groups
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_groups
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_iterations
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_iterations
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
