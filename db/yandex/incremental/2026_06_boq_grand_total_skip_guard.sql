-- =============================================================================
-- 2026_06_boq_grand_total_skip_guard.sql
--
-- Чинит 504 при создании новой версии тендера (перенос строк заказчика после
-- сопоставления версий).
--
-- Причина: триггер trg_boq_items_grand_total — AFTER INSERT/DELETE/UPDATE OF
-- total_amount FOR EACH ROW — на каждую вставленную строку boq_items вызывает
-- recalculate_tender_grand_total(), который делает полный SUM по всем boq_items
-- тендера + UPDATE строки tenders. При массовом копировании BOQ (тендер 314
-- «Событие 6.1» v5 → v6: ~5674 строки) это O(N²) пересчёт + 5674 UPDATE одной и
-- той же строки tenders, что вместе с построчными вставками укладывало запрос в
-- минуты → прод-прокси отдавал 504.
--
-- Решение: добавляем в trg_boq_items_update_grand_total() ранний guard. Если
-- вызывающий выставил `app.skip_grand_total='on'` (через SET LOCAL — scope
-- транзакции, безопасно при transaction pooling PgBouncer), per-row пересчёт
-- пропускается. Go-бэкенд (ExecuteVersionTransfer) выставляет этот GUC на время
-- переноса и один раз вызывает recalculate_tender_grand_total(new_tender_id)
-- перед commit.
--
-- Обратносовместимо: current_setting('app.skip_grand_total', true) возвращает
-- NULL когда GUC не задан → все прочие пути (обычные правки BOQ) работают как
-- раньше. CREATE OR REPLACE FUNCTION идемпотентен.
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_boq_items_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
   SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Bulk fast-path: when a bulk operation (e.g. version transfer) sets
  -- `app.skip_grand_total='on'` (SET LOCAL, transaction-scoped), skip the
  -- per-row O(N) recompute. The caller MUST call
  -- recalculate_tender_grand_total(tender_id) once before commit.
  -- current_setting(..., true) returns NULL when unset → default path unchanged.
  IF current_setting('app.skip_grand_total', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);

  -- Если tender_id сменился при UPDATE — пересчитываем и старый тендер
  IF TG_OP = 'UPDATE' AND OLD.tender_id IS DISTINCT FROM NEW.tender_id THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
