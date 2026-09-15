-- Конвейер проверки расчёта: отметки готовности по разделам ВОР.
--
-- Контекст: инженеры считают тендер параллельно и заканчивают разделы в разное
-- время, а «готово» до сих пор жило в чате. Отметка фиксирует не просто факт, а
-- содержимое раздела на момент отметки — content_hash (md5 позиций и строк
-- раздела, состав полей задан в backend/internal/repository/verification_sections.go).
-- Раздел меняется после отметки — хеш расходится, и раздел показывается
-- «изменён после отметки». Сама отметка при этом не удаляется: состояние
-- вычисляется при чтении, фоновой задачи не нужно.
--
-- Раздел ВОР — ключ section_key, а не client_positions.section_number: последнее
-- при загрузке ВОР не заполняется. Раздел выводится из иерархии позиций:
-- 'h:<id позиции-заголовка верхнего уровня>', 'none' — позиции до первого
-- заголовка, 'additional' — дополнительные позиции.
--
-- stage: 'pricing' — инженер отметил раздел расценённым; 'review' — проверяющий
-- отметил раздел проверенным. Отметки независимы: инженер может снять свою, не
-- трогая отметку проверяющего.
--
-- hash_version — версия алгоритма хеша. Смена алгоритма = осознанное массовое
-- «изменён после отметки», поэтому версия хранится рядом с хешем.
--
-- verification_section_events — история отметок и снятий.
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.verification_section_states (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id     uuid        NOT NULL,
    section_key   text        NOT NULL,
    stage         text        NOT NULL,
    content_hash  text        NOT NULL,
    hash_version  smallint    NOT NULL DEFAULT 1,
    note          text,
    marked_by     uuid,
    marked_at     timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_section_states_pkey PRIMARY KEY (id),
    CONSTRAINT verification_section_states_stage_check
        CHECK (stage IN ('pricing', 'review')),
    CONSTRAINT verification_section_states_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_section_states_unique_idx
    ON public.verification_section_states (tender_id, section_key, stage);

DROP TRIGGER IF EXISTS verification_section_states_updated_at
    ON public.verification_section_states;
CREATE TRIGGER verification_section_states_updated_at
    BEFORE UPDATE ON public.verification_section_states
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.verification_section_events (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id     uuid        NOT NULL,
    section_key   text        NOT NULL,
    stage         text        NOT NULL,
    action        text        NOT NULL,
    content_hash  text,
    note          text,
    actor_user_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_section_events_pkey PRIMARY KEY (id),
    CONSTRAINT verification_section_events_stage_check
        CHECK (stage IN ('pricing', 'review')),
    CONSTRAINT verification_section_events_action_check
        CHECK (action IN ('marked', 'unmarked')),
    CONSTRAINT verification_section_events_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS verification_section_events_tender_idx
    ON public.verification_section_events (tender_id, section_key, created_at DESC);

COMMIT;
