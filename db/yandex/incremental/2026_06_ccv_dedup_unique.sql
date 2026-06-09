-- =============================================================================
-- 2026_06_ccv_dedup_unique.sql
--
-- Чинит баг «объём не сохраняется» на странице «Затраты на строительство».
--
-- Причина: при cutover в Yandex потеряны партиальные UNIQUE-индексы таблицы
-- construction_cost_volumes, которые были в Supabase PROD
-- (construction_cost_volumes_tender_detail_key / _tender_group_key,
--  supabase/schemas/prod.sql:5494, 5497). Из-за их отсутствия неатомарный
-- upsert (SELECT → INSERT/UPDATE) под двойным POST с фронта плодил дубли строк
-- на пару (tender, detail) / (tender, group_key); правка уходила в одну строку,
-- а на экран попадала другая → «не сохранилось».
--
-- Этот скрипт:
--   1. дедуп — оставляет последнюю отредактированную строку на пару;
--   2. восстанавливает оба UNIQUE-индекса;
--   3. гарантирует колонку notes (schema drift: в live есть, в репо-файлах не было).
--
-- Идемпотентен. Дедуп (1) обязан выполняться ДО создания индексов (2).
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- =============================================================================

BEGIN;

-- 1. Дедуп по (tender_id, detail_cost_category_id): оставляем последнюю
--    по updated_at правку, остальные дубли удаляем.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tender_id, detail_cost_category_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ) AS rn
  FROM public.construction_cost_volumes
  WHERE detail_cost_category_id IS NOT NULL
)
DELETE FROM public.construction_cost_volumes v
USING ranked r
WHERE v.id = r.id AND r.rn > 1;

-- 1b. Дедуп по (tender_id, group_key).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tender_id, group_key
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ) AS rn
  FROM public.construction_cost_volumes
  WHERE group_key IS NOT NULL
)
DELETE FROM public.construction_cost_volumes v
USING ranked r
WHERE v.id = r.id AND r.rn > 1;

-- 2. Восстанавливаем потерянные при cutover UNIQUE-индексы
--    (нужны как arbiter для INSERT ... ON CONFLICT в Go-бэкенде).
CREATE UNIQUE INDEX IF NOT EXISTS construction_cost_volumes_tender_detail_key
  ON public.construction_cost_volumes (tender_id, detail_cost_category_id)
  WHERE detail_cost_category_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS construction_cost_volumes_tender_group_key
  ON public.construction_cost_volumes (tender_id, group_key)
  WHERE group_key IS NOT NULL;

-- 3. Schema drift: колонка notes (в live существует, в репо-файлах отсутствовала).
ALTER TABLE public.construction_cost_volumes ADD COLUMN IF NOT EXISTS notes text;

COMMIT;
