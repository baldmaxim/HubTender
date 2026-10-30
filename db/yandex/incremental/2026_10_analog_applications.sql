-- =============================================================================
-- 2026_10_analog_applications.sql — пилот «Расценивание по реальному аналогу».
--
-- SCOPE (только добавление, существующее не меняется):
--   * analog_applications — решение инженера «взять расценку позиции из
--     реального аналога (позиции другого тендера)». Хранит ключ идемпотентности,
--     какие строки источника взяты и какие строки созданы, правила масштаба и
--     переноса цен, отпечатки источника и цели на момент применения, снимок
--     источника и результат применения.
--   * Происхождение (source_position_id / source_tender_id) намеренно БЕЗ FK:
--     источник — чужой тендер, который могут удалить или заменить версией;
--     решение хранит снимок и остаётся читаемым.
-- Строки аналога записываются в «чёрновой» прогон тендера — import_sessions с
-- source='autoprice', label='Аналоги из архива', file_name='analog-pilot'
-- (создаётся приложением лениво; схема прогонов — 2026_10_autoprice_review.sql).
--
-- RLS и грантов нет — как у autoprice_position_reviews (доступ только через API).
--
-- Идемпотентно: IF NOT EXISTS.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.analog_applications (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key    uuid        NOT NULL UNIQUE,
    tender_id          uuid        NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
    client_position_id uuid        NOT NULL REFERENCES public.client_positions(id) ON DELETE CASCADE,
    import_session_id  uuid        NOT NULL REFERENCES public.import_sessions(id) ON DELETE CASCADE,
    source_position_id uuid        NOT NULL,
    source_tender_id   uuid        NOT NULL,
    source_item_ids    uuid[]      NOT NULL,
    new_item_ids       uuid[]      NOT NULL,
    scale_mode         text        NOT NULL CHECK (scale_mode IN ('none', 'volume_ratio', 'factor')),
    scale_factor       numeric     NOT NULL,
    source_volume      numeric,
    target_volume      numeric,
    copy_prices        boolean     NOT NULL,
    source_fingerprint text        NOT NULL,
    target_fingerprint text        NOT NULL,
    source_snapshot    jsonb       NOT NULL,
    request            jsonb       NOT NULL,
    result             jsonb       NOT NULL,
    status             text        NOT NULL DEFAULT 'applied'
                       CHECK (status IN ('applied', 'superseded', 'reverted')),
    created_by         uuid        NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    reverted_by        uuid,
    reverted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_analog_applications_position
    ON public.analog_applications (client_position_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analog_applications_tender
    ON public.analog_applications (tender_id);

COMMENT ON TABLE public.analog_applications IS
    'Решения «расценка по реальному аналогу»: что взято из позиции-источника, правила масштаба и цен, созданные строки.';
COMMENT ON COLUMN public.analog_applications.idempotency_key IS
    'Ключ повтора запроса (uuid от клиента): тот же ключ и то же тело возвращают сохранённый результат.';
COMMENT ON COLUMN public.analog_applications.source_snapshot IS
    'Снимок позиции, тендера и строк источника на момент применения (источник может измениться).';
COMMENT ON COLUMN public.analog_applications.status IS
    'applied — действует; superseded — заменено новым применением по позиции; reverted — отменено инженером.';

COMMIT;
