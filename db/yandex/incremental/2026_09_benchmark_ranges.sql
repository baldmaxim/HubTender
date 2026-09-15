-- Конвейер проверки расчёта: справочник эталонных диапазонов по классу жилья.
--
-- Контекст: объект сравнивают с ранее посчитанными по удельным показателям —
-- ₽ на единицу объёма категории (монолит за м³, кладка за м²) и ₽ на м² общей
-- площади по СП. История тендеров даёт эталон автоматически, но её бывает мало,
-- а у проверяющего есть собственные ориентиры по классам. Этот справочник их
-- хранит; при сравнении ручной диапазон важнее истории
-- (backend/internal/analytics/costbenchmark).
--
-- Цель диапазона — категория затрат (cost_categories) или детализация
-- (detail_cost_categories), либо весь тендер (level = 'total', только для ₽/м²).
-- housing_class / construction_scope NULL означает «любой».
--
-- Удаление мягкое (is_active = false): отключённый диапазон остаётся в истории и
-- не мешает завести новый на ту же цель.
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.benchmark_ranges (
    id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
    metric_kind             text        NOT NULL,
    level                   text        NOT NULL,
    cost_category_id        uuid,
    detail_cost_category_id uuid,
    housing_class           public.housing_class_type,
    construction_scope      public.construction_scope_type,
    min_value               numeric,
    max_value               numeric,
    note                    text,
    is_active               boolean     NOT NULL DEFAULT true,
    created_by              uuid,
    updated_by              uuid,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT benchmark_ranges_pkey PRIMARY KEY (id),
    CONSTRAINT benchmark_ranges_metric_check
        CHECK (metric_kind IN ('per_volume_unit', 'per_area_sp')),
    CONSTRAINT benchmark_ranges_level_check
        CHECK (level IN ('total', 'category', 'detail')),
    -- Цель согласована с уровнем; ₽ на единицу объёма у тендера целиком не бывает.
    CONSTRAINT benchmark_ranges_target_check CHECK (
        (level = 'total' AND cost_category_id IS NULL AND detail_cost_category_id IS NULL
            AND metric_kind = 'per_area_sp')
        OR (level = 'category' AND cost_category_id IS NOT NULL AND detail_cost_category_id IS NULL)
        OR (level = 'detail' AND detail_cost_category_id IS NOT NULL AND cost_category_id IS NULL)),
    CONSTRAINT benchmark_ranges_bounds_check CHECK (
        (min_value IS NOT NULL OR max_value IS NOT NULL)
        AND (min_value IS NULL OR min_value >= 0)
        AND (max_value IS NULL OR max_value >= 0)
        AND (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)),
    CONSTRAINT benchmark_ranges_category_fkey
        FOREIGN KEY (cost_category_id) REFERENCES public.cost_categories(id) ON DELETE CASCADE,
    CONSTRAINT benchmark_ranges_detail_fkey
        FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id) ON DELETE CASCADE
);

-- Один действующий диапазон на цель + класс + объём строительства.
-- NULLS NOT DISTINCT (PostgreSQL 15+): NULL в классе или объёме означает «любой»,
-- и два диапазона «для любого класса» на одну цель — дубль. Выражения вида
-- housing_class::text в индексе недопустимы (приведение enum не IMMUTABLE).
CREATE UNIQUE INDEX IF NOT EXISTS benchmark_ranges_active_unique_idx
    ON public.benchmark_ranges (
        metric_kind, level, cost_category_id, detail_cost_category_id,
        housing_class, construction_scope)
    NULLS NOT DISTINCT
    WHERE is_active;

DROP TRIGGER IF EXISTS benchmark_ranges_updated_at ON public.benchmark_ranges;
CREATE TRIGGER benchmark_ranges_updated_at
    BEFORE UPDATE ON public.benchmark_ranges
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
