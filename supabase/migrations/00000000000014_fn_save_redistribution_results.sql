-- Atomic replace of cost_redistribution_results rows for (tender, tactic).
-- Клиент вызывает через supabase.rpc('save_redistribution_results', ...)
-- одним round-trip'ом вместо пары upsert + delete.not.in.
--
-- Shape аргументов совпадает с полем body саpavase-клиента в
-- src/lib/api/redistributions.ts (ветка Supabase-фолбэка).

CREATE OR REPLACE FUNCTION public.save_redistribution_results(
  p_tender_id        uuid,
  p_markup_tactic_id uuid,
  p_records          jsonb,   -- [{boq_item_id, original_work_cost, deducted_amount, added_amount, final_work_cost}, ...]
  p_rules            jsonb,   -- JSONB-правила, кладутся на одну строку с минимальным boq_item_id
  p_created_by       uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER  -- RLS уважается, ровно как при прямых upsert/delete
SET search_path = public
AS $$
DECLARE
  v_holder uuid;
  v_count  integer;
BEGIN
  IF jsonb_array_length(p_records) = 0 THEN
    RETURN 0;
  END IF;

  -- Holder — строка с минимальным boq_item_id (детерминированный выбор,
  -- совпадает с логикой в redistributions.ts fallback и repository.go).
  SELECT (elem->>'boq_item_id')::uuid
    INTO v_holder
    FROM jsonb_array_elements(p_records) elem
   ORDER BY (elem->>'boq_item_id')::uuid
   LIMIT 1;

  -- 1. Снять rules со всех старых строк этого (tender, tactic) — holder мог смениться.
  UPDATE public.cost_redistribution_results
     SET redistribution_rules = NULL
   WHERE tender_id        = p_tender_id
     AND markup_tactic_id = p_markup_tactic_id
     AND redistribution_rules IS NOT NULL;

  -- 2. Удалить строки, которых нет в новом наборе.
  DELETE FROM public.cost_redistribution_results
   WHERE tender_id        = p_tender_id
     AND markup_tactic_id = p_markup_tactic_id
     AND boq_item_id <> ALL (
           SELECT (elem->>'boq_item_id')::uuid
             FROM jsonb_array_elements(p_records) elem
         );

  -- 3. Upsert всех записей. rules кладётся только на holder-строку.
  INSERT INTO public.cost_redistribution_results (
    tender_id, markup_tactic_id, boq_item_id,
    original_work_cost, deducted_amount, added_amount, final_work_cost,
    redistribution_rules, created_by
  )
  SELECT p_tender_id,
         p_markup_tactic_id,
         (elem->>'boq_item_id')::uuid,
         NULLIF(elem->>'original_work_cost','')::numeric,
         COALESCE(NULLIF(elem->>'deducted_amount','')::numeric, 0),
         COALESCE(NULLIF(elem->>'added_amount','')::numeric, 0),
         NULLIF(elem->>'final_work_cost','')::numeric,
         CASE WHEN (elem->>'boq_item_id')::uuid = v_holder THEN p_rules ELSE NULL END,
         p_created_by
    FROM jsonb_array_elements(p_records) elem
  ON CONFLICT (tender_id, markup_tactic_id, boq_item_id) DO UPDATE SET
    original_work_cost   = EXCLUDED.original_work_cost,
    deducted_amount      = EXCLUDED.deducted_amount,
    added_amount         = EXCLUDED.added_amount,
    final_work_cost      = EXCLUDED.final_work_cost,
    redistribution_rules = EXCLUDED.redistribution_rules,
    updated_at           = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END$$;

GRANT EXECUTE ON FUNCTION public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid) TO authenticated;
