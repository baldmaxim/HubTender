-- Этап 1.3: семантические даты источника цены BOQ-строки.
--
-- Аудит: источник цены хранится непосредственно на boq_items (quote_link
-- text); отдельной переиспользуемой source-сущности нет → даты добавляются к
-- boq_items (вариант B MVP; новая таблица НЕ создаётся).
--
--   quote_price_date  — дата, на которую поставщик/прайс/иной источник
--                       подтверждает цену (НЕ техническая created/updated_at);
--   quote_valid_until — последний день, когда источник явно действует.
--
-- Оба поля optional и являются СПРАВОЧНОЙ метаинформацией: не участвуют в
-- финансовой формуле, их изменение не двигает financial_input_revision и не
-- снимает согласование. CHECK не использует CURRENT_DATE: «дата в будущем» и
-- актуальность — прикладные проверки (server as-of date).
--
-- Идемпотентно.

BEGIN;

ALTER TABLE public.boq_items
    ADD COLUMN IF NOT EXISTS quote_price_date date NULL,
    ADD COLUMN IF NOT EXISTS quote_valid_until date NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'boq_items_quote_dates_check'
          AND conrelid = 'public.boq_items'::regclass
    ) THEN
        ALTER TABLE public.boq_items
            ADD CONSTRAINT boq_items_quote_dates_check
            CHECK (quote_valid_until IS NULL
                OR quote_price_date IS NULL
                OR quote_valid_until >= quote_price_date);
    END IF;
END
$$;

COMMENT ON COLUMN public.boq_items.quote_price_date IS
    '1.3: дата подтверждения цены источником (КП/прайс); metadata-only — не влияет на расчёт и ревизию';
COMMENT ON COLUMN public.boq_items.quote_valid_until IS
    '1.3: последний день действия источника цены; metadata-only';

COMMIT;

-- Verification (read-only):
--   SELECT count(*) FROM public.boq_items
--   WHERE quote_valid_until IS NOT NULL AND quote_price_date IS NOT NULL
--     AND quote_valid_until < quote_price_date;  -- 0
