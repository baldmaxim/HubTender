-- =============================================================================
-- 2026_11_markup_percent_set.sql — второй список базовых процентов наценок.
--
-- SCOPE: public.markup_parameters получает колонку percent_set ('old' | 'new')
-- и 6 новых параметров «нового» списка (префикс new_). Существующие 15
-- параметров автоматически остаются в списке 'old' (DEFAULT 'old').
--
-- ЗАЧЕМ: тактика наценок ссылается на параметры по ключу; «новые базовые
-- проценты» — отдельный набор ключей (рост субподряда, ООЗ субподряда, ОФЗ, НДС,
-- прибыль со скидкой). Движок расчёта (Go calc + TS-зеркало) понимает new_*
-- ключи роста субподряда и НДС наравне со старыми.
--
-- Каноничный аналог — колонка percent_set в db/yandex/sql/03_tables.sql и CHECK
-- markup_parameters_percent_set_check в db/yandex/sql/06_indexes_constraints.sql.
--
-- ИДЕМПОТЕНТНО И ПЕРЕЗАПУСКАЕМО: ADD COLUMN IF NOT EXISTS; CHECK создаётся только
-- если его нет; параметры вставляются ON CONFLICT (key) DO NOTHING.
--
-- ПОРЯДОК ВЫКАТКИ: миграция → бэкенд → фронтенд.
-- Применяется к production только после явного подтверждения пользователя.
-- =============================================================================

BEGIN;

ALTER TABLE public.markup_parameters
    ADD COLUMN IF NOT EXISTS percent_set text NOT NULL DEFAULT 'old';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'markup_parameters_percent_set_check'
          AND conrelid = 'public.markup_parameters'::regclass
    ) THEN
        ALTER TABLE public.markup_parameters
            ADD CONSTRAINT markup_parameters_percent_set_check
            CHECK (percent_set IN ('old', 'new'));
    END IF;
END $$;

INSERT INTO public.markup_parameters (key, label, is_active, order_num, default_value, percent_set)
SELECT v.key, v.label, true,
       (SELECT COALESCE(MAX(order_num), 0) FROM public.markup_parameters) + v.n,
       v.default_value, 'new'
FROM (VALUES
    (1, 'new_subcontract_works_cost_growth',     'Рост стоимости работ субподряда',      10::numeric),
    (2, 'new_subcontract_materials_cost_growth', 'Рост стоимости материалов субподряда', 10::numeric),
    (3, 'new_overhead_subcontract',              'ООЗ Субподряда',                        6::numeric),
    (4, 'new_general_costs',                     'ОФЗ',                                   5::numeric),
    (5, 'new_nds',                               'НДС',                                   3::numeric),
    (6, 'new_profit_discount',                   'Прибыль (скидка)',                      3::numeric)
) AS v(n, key, label, default_value)
ON CONFLICT (key) DO NOTHING;

-- Черновик тактики «Новая схема со сниженными процентами»: числовые множители
-- (×1,1 / 1,06 / 1,05 / 1,03 / 1,03) в «суб-раб» и «суб-мат» → ссылки на новые
-- проценты. Ключ шага — по названию; «раб»/«мат»/«комп.» не трогаем (по решению
-- пользователя «раб» и «мат» в новой схеме не считаются). Повторный прогон
-- ничего не меняет: уже переведённые шаги (operand1Type = 'markup') остаются.
WITH target AS (
    SELECT id, sequences FROM public.markup_tactics
    WHERE name = 'Новая схема со сниженными процентами'
), rebuilt AS (
    SELECT t.id, seq.type_key,
           jsonb_agg(CASE
               WHEN s.step->>'operand1Type' = 'number' AND k.new_key IS NOT NULL
               THEN s.step || jsonb_build_object('operand1Type', 'markup',
                    'operand1Key', k.new_key, 'operand1MultiplyFormat', 'addOne')
               ELSE s.step END ORDER BY s.ord) AS steps
    FROM target t
    CROSS JOIN (VALUES ('суб-раб'), ('суб-мат')) AS seq(type_key)
    CROSS JOIN LATERAL jsonb_array_elements(t.sequences -> seq.type_key)
         WITH ORDINALITY AS s(step, ord)
    CROSS JOIN LATERAL (SELECT CASE
        WHEN s.step->>'name' LIKE '%Рост%' THEN CASE seq.type_key
             WHEN 'суб-раб' THEN 'new_subcontract_works_cost_growth'
             ELSE 'new_subcontract_materials_cost_growth' END
        WHEN s.step->>'name' LIKE '%ООЗ%' THEN 'new_overhead_subcontract'
        WHEN s.step->>'name' LIKE '%ОФЗ%' THEN 'new_general_costs'
        WHEN s.step->>'name' LIKE '%НДС%' THEN 'new_nds'
        WHEN s.step->>'name' LIKE '%Прибыль%' THEN 'new_profit_discount'
    END AS new_key) k
    GROUP BY t.id, seq.type_key
)
UPDATE public.markup_tactics m
SET sequences = m.sequences
        || (SELECT jsonb_object_agg(r.type_key, r.steps) FROM rebuilt r WHERE r.id = m.id),
    updated_at = now()
WHERE m.id IN (SELECT id FROM rebuilt);

COMMIT;
