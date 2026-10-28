-- =============================================================================
-- 2026_10_autoprice_review.sql — подтверждение авторасценки (тест).
--
-- SCOPE (только добавление, существующее не меняется):
--   * import_sessions.source / label — источник сессии ('autoprice' для
--     прогонов авторасценки; NULL у обычных импортов) и подпись прогона.
--   * autoprice_position_reviews — карточка проверки позиции в прогоне:
--     основание цены (basis, pd_refs, pd_note), вопросы, находки, статус
--     подтверждения инженером и журнал событий.
-- Строки авторасценки помечаются существующей колонкой boq_items.import_session_id.
-- «Устаревание» подтверждения (approval_stale) вычисляется при чтении по
-- boq_items_audit — триггер аудита не трогаем; нужные индексы по аудиту
-- (idx_audit_new_position / idx_audit_old_position) уже есть.
--
-- Идемпотентно: IF NOT EXISTS.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.
-- =============================================================================

BEGIN;

ALTER TABLE public.import_sessions
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS label  text;

COMMENT ON COLUMN public.import_sessions.source IS
    'Источник сессии: ''autoprice'' — прогон авторасценки; NULL — обычный импорт.';
COMMENT ON COLUMN public.import_sessions.label IS
    'Подпись прогона авторасценки (для списка прогонов).';

CREATE TABLE IF NOT EXISTS public.autoprice_position_reviews (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    import_session_id  uuid        NOT NULL REFERENCES public.import_sessions(id) ON DELETE CASCADE,
    tender_id          uuid        NOT NULL,
    client_position_id uuid        NOT NULL REFERENCES public.client_positions(id) ON DELETE CASCADE,
    basis              text        CHECK (basis IN ('PD_CONFIRMED', 'ASSUMED', 'NOT_IN_PD', 'RESERVE')),
    pd_refs            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    pd_note            text,
    questions          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    findings           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    status             text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'needs_customer', 'returned', 'approved', 'excluded')),
    engineer_comment   text,
    approved_by        uuid,
    approved_at        timestamptz,
    events             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT autoprice_position_reviews_session_position_key
        UNIQUE (import_session_id, client_position_id)
);

CREATE INDEX IF NOT EXISTS idx_autoprice_position_reviews_tender
    ON public.autoprice_position_reviews (tender_id);

COMMENT ON TABLE public.autoprice_position_reviews IS
    'Проверка позиции в прогоне авторасценки: основание цены, вопросы, находки, подтверждение инженером.';

COMMIT;
