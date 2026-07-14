-- Этап 0-F2: минимальная revision-модель финансового расчёта тендера.
--
-- financial_input_revision      — растёт на 1 на каждую ПОЛЬЗОВАТЕЛЬСКУЮ
--                                 финансовую команду (не на строку batch'а);
-- financial_calculation_revision — revision входов, для которой успешно
--                                 завершён последний авторитетный расчёт;
-- financial_calculation_status  — calculated | stale | calculating | failed;
-- started_at / calculated_at    — диагностика; error_* — безопасный код/текст
--                                 (без stack trace / SQL).
--
-- Инварианты:
--   calculation_revision <= input_revision (CHECK);
--   старый расчёт не может пометить успехом новые входы (CAS в Go:
--   UPDATE ... WHERE financial_input_revision = $calculatedRevision).
--
-- Существующие тендеры после миграции: 0 / 0 / calculated (массовый пересчёт
-- НЕ выполняется — значения остаются последними materialized).
--
-- Идемпотентно: повторное применение — no-op.

BEGIN;

ALTER TABLE public.tenders
    ADD COLUMN IF NOT EXISTS financial_input_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS financial_calculation_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS financial_calculation_status text NOT NULL DEFAULT 'calculated',
    ADD COLUMN IF NOT EXISTS financial_calculation_started_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS financial_calculated_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS financial_calculation_error_code text NULL,
    ADD COLUMN IF NOT EXISTS financial_calculation_error_message text NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tenders_financial_calculation_status_check'
          AND conrelid = 'public.tenders'::regclass
    ) THEN
        ALTER TABLE public.tenders
            ADD CONSTRAINT tenders_financial_calculation_status_check
            CHECK (financial_calculation_status IN ('calculated', 'stale', 'calculating', 'failed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tenders_financial_revision_order_check'
          AND conrelid = 'public.tenders'::regclass
    ) THEN
        ALTER TABLE public.tenders
            ADD CONSTRAINT tenders_financial_revision_order_check
            CHECK (financial_calculation_revision <= financial_input_revision);
    END IF;
END
$$;

COMMENT ON COLUMN public.tenders.financial_input_revision IS
    '0-F2: revision финансовых входов; +1 на каждую пользовательскую финансовую команду (central helper MarkTenderFinancialInputsChangedTx)';
COMMENT ON COLUMN public.tenders.financial_calculation_revision IS
    '0-F2: revision входов последнего успешного авторитетного расчёта (CAS: WHERE financial_input_revision = calculatedRevision)';
COMMENT ON COLUMN public.tenders.financial_calculation_status IS
    '0-F2: calculated | stale | calculating | failed';

COMMIT;

-- Verification (read-only):
--   SELECT count(*) FROM public.tenders
--   WHERE financial_calculation_status NOT IN ('calculated','stale','calculating','failed');
--   -- 0
--   SELECT count(*) FROM public.tenders
--   WHERE financial_calculation_revision > financial_input_revision;
--   -- 0
