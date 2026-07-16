-- Этап 2.5: OpenRouter Integration & AI Administration —
-- персистентные настройки AI-фичи (одна строка на feature_code).
--
-- Инварианты:
--   * API key OpenRouter здесь НЕ хранится (только server env
--     OPENROUTER_API_KEY) — в таблице нет ни одного секретного поля;
--   * raw prompt/response, models catalog, Excel/BOQ-контент и финансовые
--     значения НЕ сохраняются: только выбранная модель (snapshot её
--     каталожных метаданных), политика, лимиты и результат synthetic-теста;
--   * цены модели — строковые decimal как получены от OpenRouter
--     (authoritative metadata не проводится через binary float);
--   * enabled=false по умолчанию; активация возможна только после
--     успешного HUBTender model test с совпадающим config hash;
--   * миграция idempotent (повторное применение безопасно), unsafe down
--     path отсутствует намеренно.

CREATE TABLE IF NOT EXISTS public.ai_feature_settings (
    feature_code text PRIMARY KEY CHECK (length(btrim(feature_code)) > 0),
    provider text NOT NULL DEFAULT 'openrouter' CHECK (provider IN ('openrouter')),

    -- Snapshot выбранной модели из user-filtered каталога OpenRouter
    -- (модель выбирается ТОЛЬКО из server-returned каталога, не вручную).
    selected_model_id text,
    selected_model_name text,
    selected_model_context_length integer,
    selected_model_max_completion_tokens integer,
    selected_model_prompt_price text,
    selected_model_completion_price text,
    selected_model_expiration_date text,
    selected_model_supported_parameters jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Версии контракта + privacy/routing policy (§10/§11 этапа 2.5).
    prompt_version text NOT NULL DEFAULT 'nomenclature-rerank-v1',
    provider_policy_version text NOT NULL DEFAULT 'openrouter-policy-v1',
    require_zdr boolean NOT NULL DEFAULT true,
    data_collection_policy text NOT NULL DEFAULT 'deny'
        CHECK (data_collection_policy IN ('deny', 'allow')),
    require_parameters boolean NOT NULL DEFAULT true,
    allow_provider_fallbacks boolean NOT NULL DEFAULT false,

    -- Операционные лимиты (в 2.5 read-only defaults; настройка — этап 2.6).
    request_timeout_seconds integer NOT NULL DEFAULT 30
        CHECK (request_timeout_seconds BETWEEN 5 AND 120),
    max_output_tokens integer NOT NULL DEFAULT 2000
        CHECK (max_output_tokens BETWEEN 128 AND 32000),
    temperature numeric(3, 2) NOT NULL DEFAULT 0
        CHECK (temperature >= 0 AND temperature <= 2),
    candidate_limit integer NOT NULL DEFAULT 20
        CHECK (candidate_limit BETWEEN 1 AND 50),
    max_rows_per_request integer NOT NULL DEFAULT 200
        CHECK (max_rows_per_request BETWEEN 1 AND 200),
    max_concurrency integer NOT NULL DEFAULT 2
        CHECK (max_concurrency BETWEEN 1 AND 3),
    monthly_budget_usd numeric(10, 2)
        CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),

    -- Результат последнего HUBTender model test (§13): только safe-поля,
    -- без raw prompt/response.
    model_test_status text NOT NULL DEFAULT 'required'
        CHECK (model_test_status IN ('required', 'passed', 'failed')),
    model_test_config_hash text,
    model_tested_model_id text,
    model_tested_at timestamp with time zone,
    model_test_latency_ms integer,
    model_test_input_tokens integer,
    model_test_output_tokens integer,
    model_test_estimated_cost text,
    model_test_error_code text,

    enabled boolean NOT NULL DEFAULT false,
    needs_review_reason text,

    updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    -- Активной может быть только конфигурация с выбранной моделью и
    -- пройденным тестом (страховка на уровне БД поверх service-гейтов).
    CONSTRAINT ai_feature_settings_enabled_requires_test CHECK (
        NOT enabled OR (
            selected_model_id IS NOT NULL
            AND model_test_status = 'passed'
            AND model_test_config_hash IS NOT NULL
        )
    )
);

-- updated_at триггер (переиспользуем общую функцию проекта).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_feature_settings_updated_at') THEN
            CREATE TRIGGER trg_ai_feature_settings_updated_at
                BEFORE UPDATE ON public.ai_feature_settings
                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
        END IF;
    END IF;
END $$;

-- Единственная feature-строка MVP: сопоставление номенклатуры.
INSERT INTO public.ai_feature_settings (feature_code)
VALUES ('nomenclature_rerank')
ON CONFLICT (feature_code) DO NOTHING;
