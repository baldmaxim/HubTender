-- =============================================================================
-- 2026_07_retire_bulk_update_commercial_costs.sql
--
-- Этап 0.1.2.2c: вывод из эксплуатации legacy SQL RPC
-- public.bulk_update_boq_items_commercial_costs(p_rows jsonb).
--
-- Раньше функция напрямую писала commercial_markup /
-- total_commercial_material_cost / total_commercial_work_cost по произвольным
-- item id (SECURITY DEFINER, без проверки принадлежности тендеру, без
-- exact-set валидации) — это DB-level обход серверного расчётного контура.
-- HTTP endpoint уже retired (410 COMMERCIAL_COST_WRITE_RETIRED, этап 0.1.2.2);
-- единственный разрешённый writer — внутренний
-- PersistCalculatedCommercialCosts (CommercialRecalcService, Go BFF).
--
-- Имя и сигнатура сохраняются на переходный период: возможны внешние stale
-- callers вне репозитория — они должны получить ЯВНУЮ ошибку, а не mutation и
-- не «function does not exist». Тело заменяется на fail-closed tombstone:
-- любой вызов (NULL, []::jsonb, {}::jsonb, валидный старый payload, чужие id)
-- всегда завершается SQLSTATE 0A000 COMMERCIAL_COST_WRITE_RETIRED до чтения
-- p_rows.
--
-- Ключевые свойства:
--   * CALLED ON NULL INPUT (НЕ STRICT) — иначе вызов с NULL вернул бы NULL
--     без выполнения тела, т.е. тихо «успешно» обошёл бы tombstone;
--   * SECURITY INVOKER — прав владельца не наследует;
--   * фиксированный search_path;
--   * REVOKE от PUBLIC + отзыв EXECUTE у всех обнаруженных non-owner grantees
--     (динамически из proacl, идемпотентно, с корректным квотированием ролей);
--   * вызов даже owner-ролью завершается ошибкой — тело всегда tombstone,
--     одних grants недостаточно.
--
-- Идемпотентность: CREATE OR REPLACE применим и к старому unsafe definition,
-- и к уже установленному tombstone; REVOKE от PUBLIC/несуществующих grants —
-- no-op; цикл по proacl при пустом ACL не делает ничего. Повторное применение
-- безопасно. Данные boq_items не изменяются, пересчёты не выполняются, другие
-- функции не затрагиваются.
--
-- Down migration, возвращающая unsafe writer, ЗАПРЕЩЕНА. При необходимости
-- отката допустим только DROP FUNCTION tombstone (тоже fail-closed: вызов даст
-- «function does not exist»).
--
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- НЕ применять к production в рамках этапа 0.1.2.2c — только после ревью.
-- =============================================================================

BEGIN;

-- 1. Тело → fail-closed tombstone (сигнатура и return type сохранены;
--    CREATE OR REPLACE меняет body/security/strictness, но не сигнатуру).
CREATE OR REPLACE FUNCTION public.bulk_update_boq_items_commercial_costs(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 CALLED ON NULL INPUT
   SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'COMMERCIAL_COST_WRITE_RETIRED'
    USING ERRCODE = '0A000',
          DETAIL  = 'Коммерческие стоимости рассчитываются только серверным расчётным контуром '
                    '(CommercialRecalcService → PersistCalculatedCommercialCosts). '
                    'Legacy RPC выведена из эксплуатации (этап 0.1.2.2c).',
          HINT    = 'Не вызывайте эту функцию: она сохранена только как fail-closed tombstone.';
END;
$function$;

-- 2. ACL: закрыть EXECUTE. Сначала PUBLIC (в т.ч. implicit default EXECUTE,
--    который действует при proacl IS NULL)…
REVOKE ALL PRIVILEGES
  ON FUNCTION public.bulk_update_boq_items_commercial_costs(jsonb)
  FROM PUBLIC;

-- …затем все явные non-owner grantees из фактического proacl (динамически:
-- не полагаемся на известные из репозитория имена ролей; grantee = 0 — это
-- PUBLIC, уже отозван выше; ::regrole даёт корректно квотированное имя).
DO $$
DECLARE
  v_oid   oid := 'public.bulk_update_boq_items_commercial_costs(jsonb)'::regprocedure;
  v_owner oid;
  g       record;
BEGIN
  SELECT proowner INTO v_owner FROM pg_proc WHERE oid = v_oid;

  FOR g IN
    SELECT a.grantee
    FROM pg_proc p, LATERAL aclexplode(p.proacl) AS a
    WHERE p.oid = v_oid
      AND a.grantee <> 0        -- PUBLIC уже отозван
      AND a.grantee <> v_owner  -- owner-права неотчуждаемы; tombstone всё равно бросает ошибку
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION public.bulk_update_boq_items_commercial_costs(jsonb) FROM %s',
      g.grantee::regrole
    );
  END LOOP;
END $$;

-- 3. Маркер retired для людей и инструментов.
COMMENT ON FUNCTION public.bulk_update_boq_items_commercial_costs(jsonb) IS
  'RETIRED (2026-07, этап 0.1.2.2c): fail-closed tombstone, всегда SQLSTATE 0A000 '
  'COMMERCIAL_COST_WRITE_RETIRED. Никогда не изменяет boq_items. '
  'Единственный writer commercial-полей — серверный PersistCalculatedCommercialCosts.';

COMMIT;

-- =============================================================================
-- VERIFICATION (read-only; выполнить вручную после применения):
--
-- 1. Свойства функции, ACL, overloads:
--
--   SELECT p.oid::regprocedure                    AS signature,
--          p.proowner::regrole                    AS owner,
--          p.prosecdef                            AS security_definer,   -- ожидается false
--          p.proisstrict                          AS is_strict,          -- ожидается false
--          pg_get_function_result(p.oid)          AS return_type,        -- integer
--          p.proacl                               AS acl,                -- без PUBLIC/non-owner EXECUTE
--          EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,'{}'::aclitem[])) a
--                  WHERE a.grantee = 0)           AS public_has_grant,   -- ожидается false
--          pg_get_functiondef(p.oid) ILIKE '%COMMERCIAL_COST_WRITE_RETIRED%'
--                                                 AS has_retired_marker, -- true
--          pg_get_functiondef(p.oid) ILIKE '%UPDATE boq_items%'
--                                                 AS has_mutation_body   -- false
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = 'bulk_update_boq_items_commercial_costs';
--
-- 2. Другие функции schema public, чьё определение ПИШЕТ commercial-колонки
--    (ожидается: только tombstone из п.1, и он не пишет; internal writer живёт
--    в Go, а не в SQL):
--
--   SELECT p.oid::regprocedure
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND pg_get_functiondef(p.oid) ~*
--         '(commercial_markup|total_commercial_material_cost|total_commercial_work_cost)\s*=';
-- =============================================================================
