-- Конвейер проверки расчёта: материализованное состояние находок правил.
--
-- Контекст: «Проверка данных» гоняла каталог правил и держала результат 10 минут в
-- памяти. Предыдущего состояния не было нигде, поэтому нельзя было ответить на
-- вопрос проверяющего «что появилось нового с прошлой проверки» — а это и есть
-- суть цикличной проверки: уже разобранное не перепроверяется, смотрим дельту.
--
-- verification_runs — один успешный прогон каталога по тендеру. trigger_source:
--   'checkpoint' — проверяющий нажал «Проверка завершена»: всё текущее считается
--   просмотренным; 'view' — открытие страницы, автообновление, «Перепроверить»;
--   'api' — машинный ключ. «Новым» считается то, что появилось после последнего
--   checkpoint. Базовой точкой не может быть любой прогон: страница сама
--   перепрогоняет правила по realtime-событию и стирала бы признак новизны до
--   того, как проверяющий его увидел.
--
-- verification_findings — ТЕКУЩЕЕ состояние находки (upsert, не журнал). Смена
--   fingerprint = данные изменились = находка открывается заново: first_seen_at
--   сдвигается, reopen_count растёт. Находка, которую правило перестало выдавать,
--   получает resolved_at. Вердикты по-прежнему живут в quality_acknowledgements —
--   здесь их не дублируем, чтобы не поддерживать две записи одного решения.
--
-- verification_finding_events — переходы (opened/reopened/resolved и вердикты):
--   история, которой у quality_acknowledgements нет, и датасет точности правил.
--
-- На находку FK по entity_id нет: пространство id зависит от entity_type
-- (boq_items, client_positions, material_names).
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд. Бэкенд без миграции продолжает отдавать
-- находки, только без признака новизны (сохранение прогона пропускается с логом).

BEGIN;

CREATE TABLE IF NOT EXISTS public.verification_runs (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id       uuid        NOT NULL,
    trigger_source  text        NOT NULL,
    input_revision  bigint      NOT NULL DEFAULT 0,
    catalog_hash    text        NOT NULL,
    rules_executed  integer     NOT NULL DEFAULT 0,
    rule_errors     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    findings_total  integer     NOT NULL DEFAULT 0,
    opened_count    integer     NOT NULL DEFAULT 0,
    reopened_count  integer     NOT NULL DEFAULT 0,
    resolved_count  integer     NOT NULL DEFAULT 0,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz NOT NULL DEFAULT now(),
    duration_ms     integer     NOT NULL DEFAULT 0,
    triggered_by    uuid,
    CONSTRAINT verification_runs_pkey PRIMARY KEY (id),
    CONSTRAINT verification_runs_trigger_check
        CHECK (trigger_source IN ('checkpoint', 'view', 'api')),
    CONSTRAINT verification_runs_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS verification_runs_tender_started_idx
    ON public.verification_runs (tender_id, started_at DESC);
-- Базовая точка «новизны» — последняя отметка «Проверка завершена».
CREATE INDEX IF NOT EXISTS verification_runs_checkpoint_idx
    ON public.verification_runs (tender_id, started_at DESC)
    WHERE trigger_source = 'checkpoint';

CREATE TABLE IF NOT EXISTS public.verification_findings (
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id          uuid        NOT NULL,
    source             text        NOT NULL DEFAULT 'rules',
    rule_code          text        NOT NULL,
    entity_type        text        NOT NULL,
    entity_id          uuid        NOT NULL,
    client_position_id uuid,
    position_number    numeric,
    item_no            text,
    severity           text        NOT NULL,
    detail             text        NOT NULL,
    money_delta        numeric,
    fingerprint        text        NOT NULL,
    first_seen_run_id  uuid,
    last_seen_run_id   uuid,
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at        timestamptz,
    reopen_count       integer     NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_findings_pkey PRIMARY KEY (id),
    CONSTRAINT verification_findings_source_check
        CHECK (source IN ('rules')),
    CONSTRAINT verification_findings_entity_type_check
        CHECK (entity_type IN ('boq_item', 'client_position', 'material_name', 'tender')),
    CONSTRAINT verification_findings_severity_check
        CHECK (severity IN ('error', 'warning', 'info')),
    CONSTRAINT verification_findings_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE,
    CONSTRAINT verification_findings_first_run_fkey
        FOREIGN KEY (first_seen_run_id) REFERENCES public.verification_runs(id) ON DELETE SET NULL,
    CONSTRAINT verification_findings_last_run_fkey
        FOREIGN KEY (last_seen_run_id) REFERENCES public.verification_runs(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_findings_unique_idx
    ON public.verification_findings (tender_id, source, rule_code, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS verification_findings_open_idx
    ON public.verification_findings (tender_id, rule_code)
    WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS verification_findings_position_idx
    ON public.verification_findings (client_position_id)
    WHERE client_position_id IS NOT NULL;

DROP TRIGGER IF EXISTS verification_findings_updated_at
    ON public.verification_findings;
CREATE TRIGGER verification_findings_updated_at
    BEFORE UPDATE ON public.verification_findings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.verification_finding_events (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    finding_id    uuid        NOT NULL,
    event_type    text        NOT NULL,
    fingerprint   text,
    run_id        uuid,
    actor_user_id uuid,
    source        text        NOT NULL DEFAULT 'system',
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_finding_events_pkey PRIMARY KEY (id),
    CONSTRAINT verification_finding_events_type_check
        CHECK (event_type IN ('opened', 'reopened', 'resolved', 'accepted', 'error')),
    CONSTRAINT verification_finding_events_source_check
        CHECK (source IN ('system', 'ui', 'telegram', 'api')),
    CONSTRAINT verification_finding_events_finding_fkey
        FOREIGN KEY (finding_id) REFERENCES public.verification_findings(id) ON DELETE CASCADE,
    CONSTRAINT verification_finding_events_run_fkey
        FOREIGN KEY (run_id) REFERENCES public.verification_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS verification_finding_events_finding_idx
    ON public.verification_finding_events (finding_id, created_at DESC);

COMMIT;
