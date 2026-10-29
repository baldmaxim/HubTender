-- =============================================================================
-- 2026_10_autoprice_skipped.sql — позиции, не попавшие в авторасценку.
--
-- SCOPE (только добавление, существующее не меняется):
--   * autoprice_skipped_positions — позиции тендера, которые загрузчик
--     авторасценки пропустил в данном прогоне, с кодом и текстом причины.
--     Набор прогона заменяется целиком (PUT .../autoprice-runs/{sid}/skipped).
--
-- Идемпотентно: IF NOT EXISTS.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.autoprice_skipped_positions (
    import_session_id  uuid        NOT NULL REFERENCES public.import_sessions(id) ON DELETE CASCADE,
    tender_id          uuid        NOT NULL,
    client_position_id uuid        NOT NULL REFERENCES public.client_positions(id) ON DELETE CASCADE,
    reason_code        text        NOT NULL
                       CHECK (reason_code IN ('no_match', 'ambiguous', 'no_volume', 'no_price', 'out_of_scope', 'error', 'other')),
    reason             text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (import_session_id, client_position_id)
);

COMMENT ON TABLE public.autoprice_skipped_positions IS
    'Позиции, не попавшие в авторасценку прогона: причина от загрузчика (код и текст).';
COMMENT ON COLUMN public.autoprice_skipped_positions.reason_code IS
    'Код причины: no_match, ambiguous, no_volume, no_price, out_of_scope, error, other.';
COMMENT ON COLUMN public.autoprice_skipped_positions.reason IS
    'Пояснение загрузчика (свободный текст, до 2000 символов).';

COMMIT;
