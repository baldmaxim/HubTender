-- ============================================================
-- Включить страхование от судимостей в cached_grand_total
-- ============================================================

-- 1. Обновляем функцию пересчёта: добавляем страховку из tender_insurance
CREATE OR REPLACE FUNCTION public.recalculate_tender_grand_total(p_tender_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boq_total   NUMERIC;
  v_insurance   NUMERIC;
  v_grand_total NUMERIC;
BEGIN
  -- Сумма коммерческих затрат по всем BOQ-позициям тендера
  SELECT COALESCE(SUM(total_commercial_material_cost + total_commercial_work_cost), 0)
  INTO v_boq_total
  FROM public.boq_items
  WHERE tender_id = p_tender_id;

  -- Сумма страхования от судимостей (если есть запись)
  SELECT COALESCE(
    (apt_price_m2 * apt_area + parking_price_m2 * parking_area + storage_price_m2 * storage_area)
    * (judicial_pct / 100.0)
    * (total_pct / 100.0),
    0
  )
  INTO v_insurance
  FROM public.tender_insurance
  WHERE tender_id = p_tender_id
  LIMIT 1;

  v_grand_total := v_boq_total + COALESCE(v_insurance, 0);

  UPDATE public.tenders
  SET cached_grand_total = ROUND(v_grand_total, 2)
  WHERE id = p_tender_id;
END;
$$;

-- 2. Функция-триггер для tender_insurance
CREATE OR REPLACE FUNCTION public.trg_insurance_update_grand_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$$;

-- 3. Триггер на таблице tender_insurance
DROP TRIGGER IF EXISTS trg_insurance_grand_total ON public.tender_insurance;
CREATE TRIGGER trg_insurance_grand_total
  AFTER INSERT OR UPDATE OR DELETE ON public.tender_insurance
  FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_update_grand_total();

-- 4. Пересчитать cached_grand_total для всех существующих тендеров
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.tenders LOOP
    PERFORM public.recalculate_tender_grand_total(r.id);
  END LOOP;
END;
$$;
