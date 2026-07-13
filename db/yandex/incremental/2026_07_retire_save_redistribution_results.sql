-- =============================================================================
-- 2026_07_retire_save_redistribution_results.sql
--
-- Этап 0.1.2.3a: вывод из эксплуатации legacy SQL RPC
-- public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid).
--
-- Раньше функция сохраняла client-calculated p_records
-- (original_work_cost / deducted_amount / added_amount / final_work_cost)
-- напрямую в cost_redistribution_results — DB-level обход серверного расчёта.
-- Теперь единственный writer — Go BFF
-- (RedistributionRepo.SaveAuthoritative → backend/internal/calc): клиент
-- передаёт только правила, все результаты рассчитывает сервер.
--
-- Имя и сигнатура сохраняются на переходный период: возможные внешние stale
-- callers должны получить ЯВНУЮ ошибку, а не mutation и не «function does not
-- exist». Тело — fail-closed tombstone: любой вызов (NULL, '[]', валидный
-- старый payload) всегда завершается SQLSTATE 0A000
-- REDISTRIBUTION_RESULT_WRITE_RETIRED до чтения p_records.
--
-- Ключевые свойства (паттерн 2026_07_retire_bulk_update_commercial_costs.sql):
--   * CALLED ON NULL INPUT (НЕ STRICT) — NULL не обходит tombstone;
--   * SECURITY INVOKER, фиксированный search_path;
--   * REVOKE от PUBLIC (включая implicit default EXECUTE) + динамический отзыв
--     EXECUTE у всех обнаруженных non-owner grantees из proacl;
--   * вызов owner-ролью тоже падает — корректность не зависит от grants.
--
-- Идемпотентность: CREATE OR REPLACE применим и к старому unsafe definition,
-- и к уже установленному tombstone; повторное применение безопасно. Данные
-- cost_redistribution_results не изменяются, пересчёты не выполняются, другие
-- функции не затрагиваются. Down migration с unsafe body ЗАПРЕЩЕНА (допустим
-- только DROP tombstone — тоже fail-closed).
--
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- НЕ применять к production в рамках этапа 0.1.2.3a — только после ревью.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.save_redistribution_results(
  p_tender_id        uuid,
  p_markup_tactic_id uuid,
  p_records          jsonb,
  p_rules            jsonb,
  p_created_by       uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
CALLED ON NULL INPUT
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'REDISTRIBUTION_RESULT_WRITE_RETIRED'
    USING ERRCODE = '0A000',
          DETAIL  = 'Результаты перераспределения рассчитывает и сохраняет только серверный '
                    'расчётный контур (Go BFF, backend/internal/calc). '
                    'Legacy RPC выведена из эксплуатации (этап 0.1.2.3a).',
          HINT    = 'Не вызывайте эту функцию: она сохранена только как fail-closed tombstone.';
END$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid)
  FROM PUBLIC;

-- Отзыв EXECUTE у всех явных non-owner grantees из фактического proacl
-- (динамически, идемпотентно, с корректным квотированием через ::regrole).
DO $$
DECLARE
  v_oid   oid := 'public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid)'::regprocedure;
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
      'REVOKE ALL PRIVILEGES ON FUNCTION public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid) FROM %s',
      g.grantee::regrole
    );
  END LOOP;
END $$;

COMMENT ON FUNCTION public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid) IS
  'RETIRED (2026-07, этап 0.1.2.3a): fail-closed tombstone, всегда SQLSTATE 0A000 '
  'REDISTRIBUTION_RESULT_WRITE_RETIRED. Никогда не изменяет cost_redistribution_results. '
  'Единственный writer — серверный RedistributionRepo.SaveAuthoritative (Go BFF).';

COMMIT;

-- =============================================================================
-- VERIFICATION (read-only; выполнить вручную после применения):
--
--   SELECT p.oid::regprocedure                    AS signature,
--          p.proowner::regrole                    AS owner,
--          p.prosecdef                            AS security_definer,   -- ожидается false
--          p.proisstrict                          AS is_strict,          -- ожидается false
--          pg_get_function_result(p.oid)          AS return_type,        -- integer
--          p.proacl                               AS acl,
--          EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,'{}'::aclitem[])) a
--                  WHERE a.grantee = 0)           AS public_has_grant,   -- ожидается false
--          pg_get_functiondef(p.oid) ILIKE '%REDISTRIBUTION_RESULT_WRITE_RETIRED%'
--                                                 AS has_retired_marker, -- true
--          pg_get_functiondef(p.oid) ILIKE '%INSERT INTO%'
--                                                 AS has_mutation_body   -- false
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = 'save_redistribution_results';
--
--   -- Функции public, пишущие в cost_redistribution_results (ожидается: нет):
--   SELECT p.oid::regprocedure
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND pg_get_functiondef(p.oid) ~* '(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?cost_redistribution_results';
-- =============================================================================
