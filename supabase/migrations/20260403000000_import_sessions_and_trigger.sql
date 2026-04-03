-- Migration: Сессии импорта BOQ и автоматический аудит через DB триггер
-- Date: 2026-04-03

-- ============================================================
-- 1. Таблица import_sessions (сессии импорта из Excel)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.import_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  file_name text,
  items_count integer NOT NULL DEFAULT 0,
  positions_snapshot jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.import_sessions IS 'Сессии массового импорта BOQ из Excel с возможностью отката';
COMMENT ON COLUMN public.import_sessions.positions_snapshot IS 'Snapshot состояния client_positions до импорта (manual_volume, manual_note) для восстановления при отмене';
COMMENT ON COLUMN public.import_sessions.items_count IS 'Количество вставленных boq_items в рамках сессии';
COMMENT ON COLUMN public.import_sessions.cancelled_at IS 'Дата и время отмены импорта (NULL = активная сессия)';
COMMENT ON COLUMN public.import_sessions.cancelled_by IS 'Кто отменил импорт';

CREATE INDEX idx_import_sessions_user_id ON public.import_sessions(user_id);
CREATE INDEX idx_import_sessions_tender_id ON public.import_sessions(tender_id);
CREATE INDEX idx_import_sessions_imported_at ON public.import_sessions(imported_at DESC);

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_sessions_select" ON public.import_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "import_sessions_insert" ON public.import_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "import_sessions_update" ON public.import_sessions
  FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- 2. Добавляем import_session_id в boq_items
-- ============================================================
ALTER TABLE public.boq_items
  ADD COLUMN IF NOT EXISTS import_session_id uuid REFERENCES public.import_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_boq_items_import_session
  ON public.boq_items(import_session_id)
  WHERE import_session_id IS NOT NULL;

-- ============================================================
-- 3. Обновляем триггер-функцию: теперь использует auth.uid()
--    (предыдущая версия использовала app.current_user_id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_boq_items_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_changed_fields text[];
  v_key text;
  v_old_val jsonb;
  v_new_val jsonb;
BEGIN
  -- Получаем user_id напрямую из JWT через auth.uid()
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- Для UPDATE вычисляем список измененных полей
  IF TG_OP = 'UPDATE' THEN
    v_changed_fields := ARRAY[]::text[];

    FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW.*)) LOOP
      v_old_val := to_jsonb(OLD.*) -> v_key;
      v_new_val := to_jsonb(NEW.*) -> v_key;

      IF v_key NOT IN ('updated_at', 'created_at')
         AND (v_old_val IS DISTINCT FROM v_new_val) THEN
        v_changed_fields := array_append(v_changed_fields, v_key);
      END IF;
    END LOOP;

    -- Если нет реальных изменений — пропускаем запись в аудит
    IF array_length(v_changed_fields, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.boq_items_audit (
    boq_item_id,
    operation_type,
    changed_by,
    old_data,
    new_data,
    changed_fields
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_user_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD.*) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW.*) ELSE NULL END,
    v_changed_fields
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- 4. Вешаем триггер на boq_items (автоматический аудит)
-- ============================================================
DROP TRIGGER IF EXISTS trg_boq_items_audit ON public.boq_items;
CREATE TRIGGER trg_boq_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.log_boq_items_changes();

-- ============================================================
-- 5. Упрощаем RPC-функции: убираем ручные вставки в audit
--    (теперь триггер делает это автоматически)
-- ============================================================

-- insert_boq_item_with_audit: просто INSERT, триггер запишет в audit
CREATE OR REPLACE FUNCTION public.insert_boq_item_with_audit(p_user_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_item record;
BEGIN
  INSERT INTO public.boq_items (
    tender_id,
    client_position_id,
    sort_number,
    boq_item_type,
    work_name_id,
    material_name_id,
    parent_work_item_id,
    unit_code,
    quantity,
    conversion_coefficient,
    consumption_coefficient,
    unit_rate,
    currency_type,
    total_amount,
    delivery_price_type,
    delivery_amount,
    quote_link,
    detail_cost_category_id,
    material_type
  ) SELECT
    (p_data->>'tender_id')::uuid,
    (p_data->>'client_position_id')::uuid,
    COALESCE((p_data->>'sort_number')::integer, 0),
    (p_data->>'boq_item_type')::boq_item_type,
    (p_data->>'work_name_id')::uuid,
    (p_data->>'material_name_id')::uuid,
    (p_data->>'parent_work_item_id')::uuid,
    p_data->>'unit_code',
    COALESCE((p_data->>'quantity')::numeric, 1),
    (p_data->>'conversion_coefficient')::numeric,
    (p_data->>'consumption_coefficient')::numeric,
    COALESCE((p_data->>'unit_rate')::numeric, 0),
    COALESCE((p_data->>'currency_type')::currency_type, 'RUB'::currency_type),
    COALESCE((p_data->>'total_amount')::numeric, 0),
    (p_data->>'delivery_price_type')::delivery_price_type,
    (p_data->>'delivery_amount')::numeric,
    p_data->>'quote_link',
    (p_data->>'detail_cost_category_id')::uuid,
    (p_data->>'material_type')::material_type
  RETURNING * INTO v_new_item;

  RETURN to_jsonb(v_new_item);
END;
$$;

-- update_boq_item_with_audit: просто UPDATE, триггер запишет в audit
CREATE OR REPLACE FUNCTION public.update_boq_item_with_audit(p_user_id uuid, p_item_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_item record;
BEGIN
  UPDATE public.boq_items
  SET
    boq_item_type = COALESCE((p_data->>'boq_item_type')::boq_item_type, boq_item_type),
    quantity = COALESCE((p_data->>'quantity')::numeric, quantity),
    unit_rate = COALESCE((p_data->>'unit_rate')::numeric, unit_rate),
    total_amount = COALESCE((p_data->>'total_amount')::numeric, total_amount),
    conversion_coefficient = COALESCE((p_data->>'conversion_coefficient')::numeric, conversion_coefficient),
    consumption_coefficient = COALESCE((p_data->>'consumption_coefficient')::numeric, consumption_coefficient),
    delivery_price_type = COALESCE((p_data->>'delivery_price_type')::delivery_price_type, delivery_price_type),
    delivery_amount = COALESCE((p_data->>'delivery_amount')::numeric, delivery_amount),
    currency_type = COALESCE((p_data->>'currency_type')::currency_type, currency_type),
    quote_link = COALESCE(p_data->>'quote_link', quote_link),
    description = COALESCE(p_data->>'description', description),
    detail_cost_category_id = COALESCE((p_data->>'detail_cost_category_id')::uuid, detail_cost_category_id),
    material_type = COALESCE((p_data->>'material_type')::material_type, material_type),
    work_name_id = COALESCE((p_data->>'work_name_id')::uuid, work_name_id),
    material_name_id = COALESCE((p_data->>'material_name_id')::uuid, material_name_id),
    unit_code = COALESCE(p_data->>'unit_code', unit_code),
    parent_work_item_id = COALESCE((p_data->>'parent_work_item_id')::uuid, parent_work_item_id),
    sort_number = COALESCE((p_data->>'sort_number')::integer, sort_number)
  WHERE id = p_item_id
  RETURNING * INTO v_new_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ item not found: %', p_item_id;
  END IF;

  RETURN to_jsonb(v_new_item);
END;
$$;

-- delete_boq_item_with_audit: просто DELETE, триггер запишет в audit
CREATE OR REPLACE FUNCTION public.delete_boq_item_with_audit(p_user_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_item record;
BEGIN
  SELECT * INTO v_old_item FROM public.boq_items WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ item not found: %', p_item_id;
  END IF;

  DELETE FROM public.boq_items WHERE id = p_item_id;

  RETURN to_jsonb(v_old_item);
END;
$$;
