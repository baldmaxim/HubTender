-- Statement-level pg_notify для cost_redistribution_results.
--
-- Контекст: авторитетный recalc (backend/internal/repository/
-- commercial_recalc_authoritative.go) теперь пере-применяет СОХРАНЁННЫЕ правила
-- перераспределения к свежим коммерческим стоимостям
-- (RefreshRedistributionSnapshotTx). Без этого снимок навсегда оставался
-- requires_recalculation / INPUT_REVISION_CHANGED после любой правки наценок,
-- пока человек не откроет страницу «Перераспределение» и не пересохранит.
--
-- Проблема, которую это обостряет: триггер pg_notify на
-- cost_redistribution_results был ПОСТРОЧНЫМ. Полная замена набора
-- (DELETE + INSERT) на крупном тендере — 6 686 строк на проде — давала ~13 400
-- уведомлений в канал `rowchange`, при том что брокер всё равно схлопывает их
-- в ОДИН publish на топик tender:<id> (дебаунс 200 мс,
-- backend/internal/realtime/broker.go). Раньше это случалось только при ручном
-- сохранении со страницы; после включения фонового обновления — после каждой
-- правки наценок.
--
-- Переводим на statement-level триггеры с transition table: 2 уведомления на
-- пару DELETE+INSERT вместо 2×N.
--
-- Контракт payload не меняется: брокер маршрутизирует ТОЛЬКО по table +
-- tender_id. Поле `id` у statement-события отсутствует (событие не про одну
-- строку) и передаётся пустой строкой — realtime.Event.ID нигде не участвует в
-- выборе топика.
--
-- Идемпотентно, безопасно для повторного применения.

CREATE OR REPLACE FUNCTION public.notify_redistribution_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    r record;
BEGIN
    -- Одно уведомление на затронутый тендер, а не на строку.
    FOR r IN
        SELECT DISTINCT tender_id FROM changed_rows WHERE tender_id IS NOT NULL
    LOOP
        PERFORM pg_notify('rowchange', jsonb_build_object(
            'table',     TG_TABLE_NAME,
            'op',        TG_OP,
            'id',        '',
            'tender_id', r.tender_id,
            'user_id',   NULL
        )::text);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_row_change_cost_redistribution_results ON public.cost_redistribution_results;
DROP TRIGGER IF EXISTS trg_notify_stmt_crr_insert ON public.cost_redistribution_results;
DROP TRIGGER IF EXISTS trg_notify_stmt_crr_update ON public.cost_redistribution_results;
DROP TRIGGER IF EXISTS trg_notify_stmt_crr_delete ON public.cost_redistribution_results;

CREATE TRIGGER trg_notify_stmt_crr_insert
    AFTER INSERT ON public.cost_redistribution_results
    REFERENCING NEW TABLE AS changed_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_redistribution_change();

CREATE TRIGGER trg_notify_stmt_crr_update
    AFTER UPDATE ON public.cost_redistribution_results
    REFERENCING NEW TABLE AS changed_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_redistribution_change();

CREATE TRIGGER trg_notify_stmt_crr_delete
    AFTER DELETE ON public.cost_redistribution_results
    REFERENCING OLD TABLE AS changed_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_redistribution_change();
