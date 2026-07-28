-- Этап 2.6|0: Controlled OpenRouter AI Rollout — пилотная группа, квоты,
-- бюджет с атомарными резервациями, circuit breaker, live evaluation,
-- безопасная обратная связь.
--
-- Инварианты:
--   * rollout_mode по умолчанию 'off'; режима general availability НЕТ;
--   * ledger/feedback НЕ хранят: source text, prompt, response, candidate
--     labels, Excel, tender ID, цены/quantity/totals BOQ;
--   * денежные поля — exact numeric (никакого binary float в учёте);
--   * миграция idempotent; к production НЕ применяется в этом этапе.

-- ── A. Rollout configuration (расширение ai_feature_settings) ───────────────
ALTER TABLE public.ai_feature_settings
    ADD COLUMN IF NOT EXISTS rollout_mode text NOT NULL DEFAULT 'off',
    ADD COLUMN IF NOT EXISTS rollout_config_version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS daily_request_limit integer NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS daily_row_limit integer NOT NULL DEFAULT 400,
    ADD COLUMN IF NOT EXISTS request_max_reserved_cost numeric(14, 8) NOT NULL DEFAULT 0.05,
    ADD COLUMN IF NOT EXISTS circuit_failure_threshold integer NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS circuit_cooldown_seconds integer NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS reservation_timeout_seconds integer NOT NULL DEFAULT 120,
    ADD COLUMN IF NOT EXISTS pilot_started_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS pilot_ended_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS last_live_evaluation_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_rollout_mode_chk') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_rollout_mode_chk
            CHECK (rollout_mode IN ('off', 'evaluation', 'pilot_individual', 'pilot_bulk'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_rollout_limits_chk') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_rollout_limits_chk
            CHECK (
                rollout_config_version >= 1
                AND daily_request_limit BETWEEN 1 AND 10000
                AND daily_row_limit BETWEEN 1 AND 1000000
                AND request_max_reserved_cost > 0
                AND circuit_failure_threshold BETWEEN 1 AND 100
                AND circuit_cooldown_seconds BETWEEN 10 AND 86400
                AND reservation_timeout_seconds BETWEEN 10 AND 3600
            );
    END IF;
END $$;

-- ── B. Pilot allowlist (server-side; user_id только из admin API) ────────────
CREATE TABLE IF NOT EXISTS public.ai_pilot_users (
    feature_code text NOT NULL REFERENCES public.ai_feature_settings(feature_code) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    is_active boolean NOT NULL DEFAULT true,
    daily_request_limit_override integer
        CHECK (daily_request_limit_override IS NULL OR daily_request_limit_override BETWEEN 1 AND 10000),
    daily_row_limit_override integer
        CHECK (daily_row_limit_override IS NULL OR daily_row_limit_override BETWEEN 1 AND 1000000),
    bulk_confirmation_allowed boolean NOT NULL DEFAULT false,
    expires_at timestamp with time zone,
    added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (feature_code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_pilot_users_active
    ON public.ai_pilot_users (feature_code, is_active) WHERE is_active;

-- ── C. Usage request ledger (safe metadata only; без raw text/финансов BOQ) ─
CREATE TABLE IF NOT EXISTS public.ai_usage_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code text NOT NULL REFERENCES public.ai_feature_settings(feature_code) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    model_id text NOT NULL,
    prompt_version text NOT NULL,
    config_hash text NOT NULL,
    request_hash text NOT NULL,
    rows_count integer NOT NULL CHECK (rows_count >= 0),
    candidates_count integer NOT NULL DEFAULT 0 CHECK (candidates_count >= 0),
    reservation_amount numeric(14, 8) NOT NULL CHECK (reservation_amount >= 0),
    actual_provider_cost numeric(14, 8) CHECK (actual_provider_cost IS NULL OR actual_provider_cost >= 0),
    estimated_cost numeric(14, 8) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
    cost_source text CHECK (cost_source IS NULL OR cost_source IN ('provider_reported', 'catalog_estimate')),
    prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens integer NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    provider_outcome text,
    request_status text NOT NULL DEFAULT 'reserved'
        CHECK (request_status IN ('reserved', 'completed', 'released', 'failed')),
    reservation_underestimate boolean NOT NULL DEFAULT false,
    latency_ms integer,
    reservation_expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_requests_user_day
    ON public.ai_usage_requests (feature_code, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_requests_month
    ON public.ai_usage_requests (feature_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_requests_reserved
    ON public.ai_usage_requests (reservation_expires_at)
    WHERE request_status = 'reserved';

-- ── D. Safe per-row feedback (без raw row text) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_row_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES public.ai_usage_requests(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    row_context_hash text NOT NULL CHECK (length(row_context_hash) BETWEEN 8 AND 128),
    confidence text NOT NULL DEFAULT '',
    deterministic_top_catalog_id text,
    ai_selected_catalog_id text,
    final_selected_catalog_id text,
    -- outcome NULL = suggestion выдан, импорт ещё не завершён.
    outcome text CHECK (outcome IS NULL OR outcome IN ('accepted', 'changed', 'manual', 'abstained', 'unresolved')),
    selection_source text,
    imported_successfully boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT ai_row_feedback_request_row_uniq UNIQUE (request_id, row_context_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_row_feedback_request
    ON public.ai_row_feedback (request_id);
CREATE INDEX IF NOT EXISTS idx_ai_row_feedback_user
    ON public.ai_row_feedback (user_id, created_at DESC);

-- ── E. Circuit breaker state (multi-instance-safe через строку БД) ──────────
CREATE TABLE IF NOT EXISTS public.ai_circuit_state (
    feature_code text PRIMARY KEY REFERENCES public.ai_feature_settings(feature_code) ON DELETE CASCADE,
    circuit_state text NOT NULL DEFAULT 'closed'
        CHECK (circuit_state IN ('closed', 'open', 'half_open')),
    consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    open_until timestamp with time zone,
    last_failure_code text,
    last_success_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ── F. Evaluation summaries (только безопасные агрегаты; без raw dataset) ───
CREATE TABLE IF NOT EXISTS public.ai_evaluation_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code text NOT NULL REFERENCES public.ai_feature_settings(feature_code) ON DELETE CASCADE,
    eval_mode text NOT NULL CHECK (eval_mode IN ('deterministic', 'mock', 'live')),
    dataset_kind text NOT NULL CHECK (dataset_kind IN ('synthetic', 'approved_aliases')),
    dataset_hash text NOT NULL,
    dataset_size integer NOT NULL CHECK (dataset_size >= 0),
    model_id text NOT NULL,
    prompt_version text NOT NULL,
    config_hash text NOT NULL,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    gates_passed boolean NOT NULL DEFAULT false,
    gate_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    executed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    executed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_evaluation_summaries_feature
    ON public.ai_evaluation_summaries (feature_code, executed_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_last_eval_fkey') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_last_eval_fkey
            FOREIGN KEY (last_live_evaluation_id)
            REFERENCES public.ai_evaluation_summaries(id) ON DELETE SET NULL;
    END IF;
END $$;

-- updated_at триггеры (общая функция проекта).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_pilot_users_updated_at') THEN
            CREATE TRIGGER trg_ai_pilot_users_updated_at
                BEFORE UPDATE ON public.ai_pilot_users
                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_circuit_state_updated_at') THEN
            CREATE TRIGGER trg_ai_circuit_state_updated_at
                BEFORE UPDATE ON public.ai_circuit_state
                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
        END IF;
    END IF;
END $$;

-- Circuit-строка для единственной feature MVP.
INSERT INTO public.ai_circuit_state (feature_code)
SELECT 'nomenclature_rerank'
WHERE EXISTS (SELECT 1 FROM public.ai_feature_settings WHERE feature_code = 'nomenclature_rerank')
ON CONFLICT (feature_code) DO NOTHING;
