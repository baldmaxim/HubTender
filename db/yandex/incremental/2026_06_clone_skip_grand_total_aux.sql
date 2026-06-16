-- =============================================================================
-- 2026_06_clone_skip_grand_total_aux.sql
--
-- Дополняет 2026_06_boq_grand_total_skip_guard.sql: распространяет guard
-- `app.skip_grand_total='on'` на три смежных grand-total триггера, у которых
-- его не было.
--
-- Причина: при дублировании (clone_tender_as_new_version) и переносе версии
-- bulk-вставки в tender_insurance / tender_markup_percentage /
-- subcontract_growth_exclusions идут уже ПОСЛЕ массовой вставки boq_items.
-- Каждая такая строка через свой AFTER INSERT FOR EACH ROW триггер вызывает
-- recalculate_tender_grand_total(), т.е. полный SUM по тысячам boq_items —
-- лишние N полных сканов на операцию.
--
-- Решение: тот же ранний guard, что в trg_boq_items_update_grand_total. Если
-- вызывающий выставил app.skip_grand_total='on' (SET LOCAL — scope транзакции),
-- per-row пересчёт пропускается; bulk-путь (clone/transfer) один раз зовёт
-- recalculate_tender_grand_total(new_tender_id) перед commit.
--
-- Обратносовместимо: current_setting('app.skip_grand_total', true) = NULL когда
-- GUC не задан → обычные правки (страховка/наценки/исключения по одной строке)
-- работают как раньше. CREATE OR REPLACE FUNCTION идемпотентен.
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_insurance_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Bulk fast-path: skip per-row recompute when a bulk op (clone/transfer)
  -- sets app.skip_grand_total='on'. Caller recomputes once before commit.
  IF current_setting('app.skip_grand_total', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_markup_pct_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
   SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Bulk fast-path: skip per-row recompute when a bulk op (clone/transfer)
  -- sets app.skip_grand_total='on'. Caller recomputes once before commit.
  IF current_setting('app.skip_grand_total', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_subcontract_excl_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
   SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Bulk fast-path: skip per-row recompute when a bulk op (clone/transfer)
  -- sets app.skip_grand_total='on'. Caller recomputes once before commit.
  IF current_setting('app.skip_grand_total', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

COMMIT;
