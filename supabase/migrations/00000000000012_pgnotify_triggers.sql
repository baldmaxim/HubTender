-- Migration 12/n: pg_notify triggers for native WebSocket hub.
-- Part of Phase 4 slice 4a — replaces Supabase Realtime for 6 frontend subscriptions.
-- Target: pre-prod project ocauafggjrqvopxjihas.

-- Generic trigger function that emits {table, op, id, tender_id, user_id} on
-- channel 'rowchange'. Attached AFTER INSERT/UPDATE/DELETE to 6 tables.
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
    ELSE
        -- boq_items, client_positions, cost_redistribution_results, construction_cost_volumes
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
