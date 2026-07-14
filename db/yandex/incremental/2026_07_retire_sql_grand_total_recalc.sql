-- =============================================================================
-- 2026_07_retire_sql_grand_total_recalc.sql
--
-- Этап 0.1.2.4a: единственный источник формулы tenders.cached_grand_total —
-- backend/internal/calc (CalculateCachedTenderGrandTotal +
-- CalculateInsuranceTotal); запись выполняет transaction-aware Go helper
-- RecalculateTenderGrandTotalTx.
--
-- Эта миграция выводит из эксплуатации SQL-слой:
--   1. Удаляет 4 per-row grand-total триггера (вторая SQL-формула, O(N) SUM из
--      per-row триггера; часть срабатывала ДО материализации новых commercial
--      values и «освежала» итог по старым полям).
--   2. Удаляет их trigger-функции (не оставлять unattached функции с рабочей
--      финансовой формулой).
--   3. Превращает public.recalculate_tender_grand_total(uuid) в fail-closed
--      tombstone (имя/сигнатура сохранены ради внешних stale callers).
--   4. Отзывает EXECUTE у PUBLIC и всех обнаруженных non-owner grantees.
--
-- GUC app.skip_grand_total после удаления триггеров БОЛЬШЕ НИКЕМ НЕ ЧИТАЕТСЯ
-- (application-код тоже перестал его выставлять).
--
-- Свойства: транзакционная; идемпотентная (DROP IF EXISTS + CREATE OR REPLACE);
-- применима к старому состоянию с триггерами, к частично обновлённому и к уже
-- retired; НЕ изменяет financial data; НЕ выполняет массовый пересчёт тендеров.
-- Down migration с возвратом SQL-формулы ЗАПРЕЩЕНА (допустим только DROP
-- tombstone — тоже fail-closed).
--
-- DEPLOYMENT ORDER (обязателен):
--   1. Сначала application release этапа 0.1.2.4a (нет SQL callers; все
--      category-A пути пересчитывают итог Go-helper'ом в своей транзакции).
--   2. Проверка application metrics/logs.
--   3. Затем эта миграция. Старый application instance после миграции
--      fail-closed — допустимо, но rolling deployment должен быть завершён.
--
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- НЕ применять к production в рамках этапа 0.1.2.4a — только после ревью.
-- =============================================================================

BEGIN;

-- 1. Триггеры (первыми — чтобы ни одна строка ниже не сработала через них).
DROP TRIGGER IF EXISTS trg_boq_items_grand_total        ON public.boq_items;
DROP TRIGGER IF EXISTS trg_insurance_grand_total        ON public.tender_insurance;
DROP TRIGGER IF EXISTS trg_markup_pct_grand_total       ON public.tender_markup_percentage;
DROP TRIGGER IF EXISTS trg_subcontract_excl_grand_total ON public.subcontract_growth_exclusions;

-- 2. Trigger-функции (вторая копия финансовой формулы через PERFORM).
DROP FUNCTION IF EXISTS public.trg_boq_items_update_grand_total();
DROP FUNCTION IF EXISTS public.trg_insurance_update_grand_total();
DROP FUNCTION IF EXISTS public.trg_markup_pct_update_grand_total();
DROP FUNCTION IF EXISTS public.trg_subcontract_excl_update_grand_total();

-- 3. Recalc-функция → fail-closed tombstone (сигнатура сохранена).
CREATE OR REPLACE FUNCTION public.recalculate_tender_grand_total(p_tender_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY INVOKER
 CALLED ON NULL INPUT
   SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'GRAND_TOTAL_SQL_RETIRED'
    USING ERRCODE = '0A000',
          DETAIL  = 'Итог тендера (cached_grand_total) рассчитывается только серверным '
                    'расчётным контуром (Go BFF, backend/internal/calc). '
                    'SQL-функция выведена из эксплуатации (этап 0.1.2.4a).',
          HINT    = 'Не вызывайте эту функцию: она сохранена только как fail-closed tombstone.';
END;
$function$;

-- 4. ACL: PUBLIC (включая implicit default EXECUTE)…
REVOKE ALL PRIVILEGES
  ON FUNCTION public.recalculate_tender_grand_total(uuid)
  FROM PUBLIC;

-- …и все явные non-owner grantees из фактического proacl (динамически,
-- идемпотентно, с корректным квотированием через ::regrole).
DO $$
DECLARE
  v_oid   oid := 'public.recalculate_tender_grand_total(uuid)'::regprocedure;
  v_owner oid;
  g       record;
BEGIN
  SELECT proowner INTO v_owner FROM pg_proc WHERE oid = v_oid;

  FOR g IN
    SELECT a.grantee
    FROM pg_proc p, LATERAL aclexplode(p.proacl) AS a
    WHERE p.oid = v_oid
      AND a.grantee <> 0        -- PUBLIC уже отозван выше
      AND a.grantee <> v_owner  -- owner-права неотчуждаемы; tombstone всё равно бросает ошибку
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.recalculate_tender_grand_total(uuid) FROM %s',
      g.grantee::regrole
    );
  END LOOP;
END $$;

COMMENT ON FUNCTION public.recalculate_tender_grand_total(uuid) IS
  'RETIRED (2026-07, этап 0.1.2.4a): fail-closed tombstone, всегда SQLSTATE 0A000 '
  'GRAND_TOTAL_SQL_RETIRED. Никогда не читает boq_items/insurance и не пишет tenders. '
  'Единственный writer cached_grand_total — Go helper RecalculateTenderGrandTotalTx.';

COMMIT;

-- =============================================================================
-- VERIFICATION (read-only; выполнить вручную после применения):
--
-- 1. Grand-total триггеры отсутствуют (ожидается 0 строк):
--
--   SELECT tgname, tgrelid::regclass
--   FROM pg_trigger
--   WHERE NOT tgisinternal
--     AND tgname IN ('trg_boq_items_grand_total','trg_insurance_grand_total',
--                    'trg_markup_pct_grand_total','trg_subcontract_excl_grand_total');
--
-- 2. Trigger-функции отсутствуют (ожидается 0 строк):
--
--   SELECT p.oid::regprocedure
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public'
--     AND p.proname IN ('trg_boq_items_update_grand_total','trg_insurance_update_grand_total',
--                       'trg_markup_pct_update_grand_total','trg_subcontract_excl_update_grand_total');
--
-- 3. Recalc-функция — tombstone (secdef=false, strict=false, PUBLIC нет,
--    non-owner нет, retired marker есть, формулы нет):
--
--   SELECT p.oid::regprocedure                    AS signature,
--          p.proowner::regrole                    AS owner,
--          p.prosecdef, p.proisstrict, p.proacl,
--          EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,'{}'::aclitem[])) a
--                  WHERE a.grantee = 0)           AS public_has_grant,     -- false
--          pg_get_functiondef(p.oid) ILIKE '%GRAND_TOTAL_SQL_RETIRED%'
--                                                 AS has_retired_marker,   -- true
--          pg_get_functiondef(p.oid) ILIKE '%UPDATE public.tenders%'
--            OR pg_get_functiondef(p.oid) ILIKE '%cached_grand_total%'
--                                                 AS has_formula_marker    -- false
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname='recalculate_tender_grand_total';
--
-- 4. Прочие functions/triggers/views, упоминающие финансовые входы итога
--    (найденные read-only usages объяснить отдельно):
--
--   SELECT p.oid::regprocedure
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public'
--     AND (pg_get_functiondef(p.oid) ILIKE '%cached_grand_total%'
--       OR pg_get_functiondef(p.oid) ILIKE '%total_commercial_material_cost%'
--       OR pg_get_functiondef(p.oid) ILIKE '%total_commercial_work_cost%'
--       OR pg_get_functiondef(p.oid) ILIKE '%tender_insurance%');
-- =============================================================================
