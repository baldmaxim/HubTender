-- Конвейер проверки: ИИ-разбор находок правил.
--
-- Правила SQL ищут кандидатов широко и не отличают, например, утеплитель в два слоя
-- (коэффициенты 0.05 + 0.1 = 150 мм по строке заказчика) от задвоения. После фонового
-- прогона сервер отдаёт модели новые находки вместе с контекстом позиции, и модель
-- оценивает каждую: «похоже на ошибку», «похоже на норму», «не уверен» — с причиной и
-- ссылками на поля расчёта. Сервер проверяет ссылки; оценка без подтверждённых ссылок
-- сводится к «не уверен». Оценка — подсказка проверяющему, вердикт не ставится.
--
-- verification_ai_settings    — одна строка: включено, модель, пилотные тендеры, лимиты,
--                               результат последней проверки модели.
-- verification_ai_assessments — текущая оценка находки (одна на находку). Привязана к
--                               отпечатку: данные изменились — оценка устарела и находка
--                               разбирается заново.
-- verification_ai_requests    — журнал запросов к модели: токены, стоимость, ошибки.
--                               Бюджет месяца считается по нему.
--
-- Модель и ключ — общие с остальным ИИ (транспорт openrouter/proxy_llm, ключ из
-- «Настройки ИИ»). Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.verification_ai_settings (
    id                      smallint    NOT NULL DEFAULT 1,
    enabled                 boolean     NOT NULL DEFAULT false,
    model_id                text,
    allowed_tender_ids      uuid[],
    max_findings_per_run    integer     NOT NULL DEFAULT 200,
    batch_size              integer     NOT NULL DEFAULT 8,
    max_output_tokens       integer     NOT NULL DEFAULT 3000,
    request_timeout_seconds integer     NOT NULL DEFAULT 120,
    monthly_token_budget    bigint      NOT NULL DEFAULT 10000000,
    daily_request_limit     integer     NOT NULL DEFAULT 1000,
    last_test_at            timestamptz,
    last_test_model_id      text,
    last_test_status        text,
    last_test_error         text,
    last_test_latency_ms    integer,
    updated_by              uuid,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_ai_settings_pkey PRIMARY KEY (id),
    CONSTRAINT verification_ai_settings_single_check CHECK (id = 1),
    CONSTRAINT verification_ai_settings_limits_check CHECK (
        max_findings_per_run BETWEEN 1 AND 2000
        AND batch_size BETWEEN 1 AND 20
        AND max_output_tokens BETWEEN 256 AND 32000
        AND request_timeout_seconds BETWEEN 10 AND 600
        AND monthly_token_budget > 0
        AND daily_request_limit BETWEEN 1 AND 100000),
    CONSTRAINT verification_ai_settings_test_status_check
        CHECK (last_test_status IS NULL OR last_test_status IN ('passed', 'failed')),
    -- IS NOT DISTINCT FROM, а не «=»: CHECK с NULL-результатом считается пройденным,
    -- и разбор включился бы без единой проверки модели.
    CONSTRAINT verification_ai_settings_enabled_check
        CHECK (NOT enabled OR (model_id IS NOT NULL
                               AND last_test_status IS NOT DISTINCT FROM 'passed'
                               AND last_test_model_id IS NOT DISTINCT FROM model_id))
);

INSERT INTO public.verification_ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.verification_ai_requests (
    id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id         uuid,
    trigger_source    text        NOT NULL,
    status            text        NOT NULL,
    model_id          text        NOT NULL,
    prompt_version    text        NOT NULL,
    findings_count    integer     NOT NULL DEFAULT 0,
    assessed_count    integer     NOT NULL DEFAULT 0,
    prompt_tokens     integer     NOT NULL DEFAULT 0,
    completion_tokens integer     NOT NULL DEFAULT 0,
    total_tokens      integer     NOT NULL DEFAULT 0,
    cost              numeric(14, 8),
    latency_ms        integer     NOT NULL DEFAULT 0,
    error_code        text,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_ai_requests_pkey PRIMARY KEY (id),
    CONSTRAINT verification_ai_requests_trigger_check
        CHECK (trigger_source IN ('auto', 'manual', 'test')),
    CONSTRAINT verification_ai_requests_status_check
        CHECK (status IN ('completed', 'failed', 'invalid')),
    CONSTRAINT verification_ai_requests_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS verification_ai_requests_created_idx
    ON public.verification_ai_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS verification_ai_requests_tender_idx
    ON public.verification_ai_requests (tender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.verification_ai_assessments (
    finding_id     uuid        NOT NULL,
    tender_id      uuid        NOT NULL,
    rule_code      text        NOT NULL,
    fingerprint    text        NOT NULL,
    prompt_version text        NOT NULL,
    model_id       text        NOT NULL,
    label          text        NOT NULL,
    reason         text        NOT NULL DEFAULT '',
    evidence       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    downgraded     boolean     NOT NULL DEFAULT false,
    request_id     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_ai_assessments_pkey PRIMARY KEY (finding_id),
    CONSTRAINT verification_ai_assessments_label_check
        CHECK (label IN ('likely_error', 'likely_ok', 'unsure')),
    CONSTRAINT verification_ai_assessments_finding_fkey
        FOREIGN KEY (finding_id) REFERENCES public.verification_findings(id) ON DELETE CASCADE,
    CONSTRAINT verification_ai_assessments_request_fkey
        FOREIGN KEY (request_id) REFERENCES public.verification_ai_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS verification_ai_assessments_tender_idx
    ON public.verification_ai_assessments (tender_id);

COMMIT;
