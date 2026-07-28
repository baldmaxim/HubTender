-- =============================================================================
-- 2026_07_fi_discounts.sql — снижение коммерческой стоимости на странице
-- «Финансовые показатели».
--
-- SCOPE: одна таблица public.tender_fi_discounts — одна строка на тендер,
-- хранящая ТОЛЬКО параметры снижения:
--
--   enabled  boolean — тумблер «Применять снижение». По умолчанию false, поэтому
--                      тендер без строки в таблице ведёт себя ровно как сегодня.
--                      Выключение тумблера НЕ стирает rules.
--   rules    jsonb   — [{ "amount": 30000, "positionIds": ["uuid", ...] }, ...]
--
-- Денежные результаты здесь НЕ хранятся: дельты пересчитываются на загрузке из
-- прямых затрат и каскада наценок тендера — тот же принцип, что в
-- cost_redistribution_results.redistribution_rules.position_adjustments,
-- см. docs/CALCULATION_SOURCE_OF_TRUTH.md.
--
-- Realtime: таблица несёт tender_id, поэтому попадает в generic-ветку
-- public.notify_row_change() (db/yandex/sql/07_pgnotify.sql) и разъезжается в
-- топик `tender:<tender_id>` без изменений на бэкенде.
--
-- Transaction wrapping (BEGIN/COMMIT) выполняет apply-скрипт, как в
-- db/yandex/sql/*.sql. Идемпотентно.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_fi_discounts (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id  uuid NOT NULL,
    enabled    boolean NOT NULL DEFAULT false,
    rules      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ----- constraints -----------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_pkey'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_pkey PRIMARY KEY (id);
    END IF;

    -- Одна строка настроек на тендер: UPSERT в репозитории опирается на этот UNIQUE.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_tender_fi_discounts_tender'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT uq_tender_fi_discounts_tender UNIQUE (tender_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_tender_id_fkey'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_tender_id_fkey
            FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_created_by_fkey'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id);
    END IF;

    -- rules всегда JSON-массив: битый объект/скаляр ломал бы разбор на фронте.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tender_fi_discounts_rules_is_array'
    ) THEN
        ALTER TABLE public.tender_fi_discounts
            ADD CONSTRAINT tender_fi_discounts_rules_is_array
            CHECK (jsonb_typeof(rules) = 'array');
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_tender_fi_discounts_created_by
    ON public.tender_fi_discounts USING btree (created_by);

-- ----- updated_at ------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_tender_fi_discounts_updated_at ON public.tender_fi_discounts;
CREATE TRIGGER trigger_update_tender_fi_discounts_updated_at
    BEFORE UPDATE ON public.tender_fi_discounts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- realtime fan-out → tender:<tender_id> ---------------------------------
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_fi_discounts ON public.tender_fi_discounts;
CREATE TRIGGER trg_notify_row_change_tender_fi_discounts
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_fi_discounts
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
