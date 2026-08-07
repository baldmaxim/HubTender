-- Режим LLM-прокси (proxy_llm), вариант A: модель выбирает прокси.
--
-- Зачем: у прод-хоста нет исходящего доступа к openrouter.ai. Вызовы идут через
-- собственный OpenAI-совместимый прокси, у которого есть ТОЛЬКО
-- POST /api/v1/chat/completions и публичный GET /healthz.
--
-- Что из этого следует для данных:
--   * provider получает второе допустимое значение;
--   * цена модели неизвестна (каталога нет) ⇒ USD-бюджет вырождается в счётчик
--     запросов по плоскому резерву. Взамен вводится ИЗМЕРИМЫЙ потолок в токенах:
--     usage прокси отдаёт всегда;
--   * прокси вырезает объект provider ⇒ ZDR / data_collection=deny /
--     require_parameters НЕ применяются. Приватность делегирована оператору
--     прокси и требует явного аудируемого подтверждения (proxy_privacy_ack_*);
--   * модель может смениться на стороне оператора между model test и боевым
--     вызовом — фактическая модель из ответа фиксируется отдельно.
--
-- Миграция additive и idempotent; все колонки nullable либо с DEFAULT —
-- совместима со старым backend.

-- ── A. Новые колонки ─────────────────────────────────────────────────────────

ALTER TABLE public.ai_feature_settings
    -- Измеримый потолок расхода: заменяет USD-бюджет там, где цены неизвестны.
    ADD COLUMN IF NOT EXISTS monthly_token_budget bigint,
    -- Фактическая модель, ответившая на synthetic model test (вариант A:
    -- присланный model игнорируется, реальную видно только из ответа).
    ADD COLUMN IF NOT EXISTS model_test_observed_model text,
    -- В proxy-режиме config hash не пришпиливает модель (в нём константа
    -- 'proxy'), поэтому единственная защита от дрейфа — протухание теста.
    ADD COLUMN IF NOT EXISTS model_test_max_age_hours integer NOT NULL DEFAULT 168,
    -- Аудируемое подтверждение делегирования privacy-политики оператору прокси.
    -- Перезапрашивается при любой смене provider_policy_version.
    ADD COLUMN IF NOT EXISTS proxy_privacy_ack_by uuid,
    ADD COLUMN IF NOT EXISTS proxy_privacy_ack_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS proxy_privacy_ack_policy_version text;

ALTER TABLE public.ai_usage_requests
    -- Фактическая модель ответа: ловит дрейф модели на стороне оператора.
    ADD COLUMN IF NOT EXISTS observed_model text,
    -- x-openrouter-request-id (gen-…): единственный мост от нашего ledger'а
    -- к реальному счёту OpenRouter.
    ADD COLUMN IF NOT EXISTS upstream_request_id text,
    -- Оценка токенов на момент резервации. Без неё запросы «в полёте» не
    -- учитывались бы в токенном потолке, и он превышался бы на величину
    -- max_concurrency × размер запроса.
    ADD COLUMN IF NOT EXISTS reserved_tokens bigint;

-- ── B. Расширение CHECK-ограничений ──────────────────────────────────────────
-- Исходные ограничения заданы инлайн и имеют авто-имена, поэтому ищем их по
-- определению, а не по предполагаемому имени.

DO $$
DECLARE c record;
BEGIN
    -- B1. provider: допускаем proxy_llm.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.ai_feature_settings'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%provider%'
          AND pg_get_constraintdef(oid) ILIKE '%openrouter%'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_feature_settings DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_provider_chk') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_provider_chk
            CHECK (provider IN ('openrouter', 'proxy_llm'));
    END IF;

    -- B2. request_timeout_seconds: потолок 120 → 240. Дедлайн прокси ~190 с,
    -- и при 120 батч из 8 строк упирается в наш таймаут раньше, чем в его.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.ai_feature_settings'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%request_timeout_seconds%'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_feature_settings DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_request_timeout_chk') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_request_timeout_chk
            CHECK (request_timeout_seconds BETWEEN 5 AND 240);
    END IF;

    -- B3. cost_source: третье значение для режима без цен. Резерв в этом случае
    -- плоский (request_max_reserved_cost), и выдавать его за catalog_estimate
    -- значило бы соврать в отчётах о расходе.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.ai_usage_requests'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%cost_source%'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_usage_requests DROP CONSTRAINT %I', c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_requests_cost_source_chk') THEN
        ALTER TABLE public.ai_usage_requests ADD CONSTRAINT ai_usage_requests_cost_source_chk
            CHECK (cost_source IS NULL OR cost_source IN
                ('provider_reported', 'catalog_estimate', 'unpriced_reservation'));
    END IF;
END $$;

-- ── C. Связка таймаутов: резервация обязана переживать вызов ─────────────────
-- Реальный баг, который иначе вносит поднятие request_timeout_seconds: при 120 с
-- на попытку и одном ретрае худший случай ≈250 с. Если резервация истекает
-- раньше, maintenance освободит её, пока вызов ещё в полёте, и последующий
-- ReconcileUsage отработает по уже отпущенной строке — двойной учёт расхода.
--
-- Дефолты (30 / 120) ограничение проходят, поэтому существующие строки не
-- ломаются; поднять request_timeout_seconds без резервации станет невозможно.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_reservation_covers_request_chk') THEN
        ALTER TABLE public.ai_feature_settings
            ADD CONSTRAINT ai_feature_settings_reservation_covers_request_chk
            CHECK (reservation_timeout_seconds >= request_timeout_seconds * 2 + 60);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_token_budget_chk') THEN
        ALTER TABLE public.ai_feature_settings
            ADD CONSTRAINT ai_feature_settings_token_budget_chk
            CHECK (monthly_token_budget IS NULL OR monthly_token_budget > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_model_test_age_chk') THEN
        ALTER TABLE public.ai_feature_settings
            ADD CONSTRAINT ai_feature_settings_model_test_age_chk
            CHECK (model_test_max_age_hours BETWEEN 1 AND 8760);
    END IF;
END $$;

COMMENT ON COLUMN public.ai_feature_settings.monthly_token_budget IS
    'Измеримый месячный потолок в токенах. Нужен в режиме proxy_llm, где цена модели неизвестна и USD-бюджет вырождается в счётчик запросов.';
COMMENT ON COLUMN public.ai_feature_settings.model_test_observed_model IS
    'Модель, фактически ответившая на model test. В варианте A присланный model игнорируется прокси.';
COMMENT ON COLUMN public.ai_feature_settings.proxy_privacy_ack_policy_version IS
    'provider_policy_version, для которой дано подтверждение. Несовпадение с текущей = подтверждение требуется заново.';
COMMENT ON COLUMN public.ai_usage_requests.upstream_request_id IS
    'x-openrouter-request-id (gen-…) для сверки с биллингом OpenRouter.';
