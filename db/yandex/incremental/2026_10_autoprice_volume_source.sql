-- =============================================================================
-- 2026_10_autoprice_volume_source.sql — источник объёма позиции в проверке
-- авторасценки.
--
-- SCOPE (только добавление, существующее не меняется):
--   * autoprice_position_reviews.volume_source — откуда авторасценка взяла
--     объём позиции: {"kind":"ai_model|conditional|customer_boq", "value":…,
--     "unit":…, "label":…, "ref":…, "note":…}. NULL — источник не указан.
--     Формат проверяет бэкенд; CHECK страхует только вид и тип значения.
--
-- Идемпотентно: IF NOT EXISTS / проверка наличия ограничения.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.
-- =============================================================================

BEGIN;

ALTER TABLE public.autoprice_position_reviews
    ADD COLUMN IF NOT EXISTS volume_source jsonb NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'autoprice_position_reviews_volume_source_check'
          AND conrelid = 'public.autoprice_position_reviews'::regclass
    ) THEN
        ALTER TABLE public.autoprice_position_reviews
            ADD CONSTRAINT autoprice_position_reviews_volume_source_check
            CHECK (volume_source IS NULL OR (
                jsonb_typeof(volume_source) = 'object'
                AND volume_source ->> 'kind' IN ('ai_model', 'conditional', 'customer_boq')
            ));
    END IF;
END $$;

COMMENT ON COLUMN public.autoprice_position_reviews.volume_source IS
    'Источник объёма позиции: {kind: ai_model|conditional|customer_boq, value?, unit?, label?, ref?, note?}.';

COMMIT;
