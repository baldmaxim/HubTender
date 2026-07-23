-- =============================================================================
-- 2026_07_fi_discounts_zeroing.sql — режим «Обнуление» на «Финансовых показателях».
--
-- Добавляет к public.tender_fi_discounts:
--   mode                 — активный режим корректировки: 'discount' (снижение
--                          суммой, как было) или 'zeroing' (полное обнуление
--                          выбранных строк заказчика). Режимы взаимоисключающие;
--                          настройки неактивного режима сохраняются.
--   zeroed_position_ids  — jsonb-массив client_positions.id, которые полностью
--                          обнуляются (работы + материалы, база и коммерция).
--                          Как и rules — ТОЛЬКО параметры, суммы пересчитываются
--                          на загрузке (docs/CALCULATION_SOURCE_OF_TRUTH.md).
--
-- Идемпотентно. Transaction wrapping — apply-скрипт.
-- =============================================================================

ALTER TABLE public.tender_fi_discounts
    ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'discount';

ALTER TABLE public.tender_fi_discounts
    ADD COLUMN IF NOT EXISTS zeroed_position_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_mode_check'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_mode_check
            CHECK (mode IN ('discount', 'zeroing'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_zeroed_is_array'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_zeroed_is_array
            CHECK (jsonb_typeof(zeroed_position_ids) = 'array');
    END IF;
END
$$;
