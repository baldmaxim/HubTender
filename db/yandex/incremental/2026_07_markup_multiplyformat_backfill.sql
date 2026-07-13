-- P0: backfill markup_tactics.sequences — operandNMultiplyFormat для multiply+markup.
--
-- Контекст: production-калькулятор ранее трактовал отсутствующий
-- operandNMultiplyFormat как 'direct' (10% → ×0.1), тогда как конструктор — как
-- 'addOne' (10% → ×1.1). Дефолт исправлен на addOne. Эта миграция делает
-- сохранённые данные явными: для каждого шага и слота 1..5, где
-- actionN='multiply' и operandNType='markup', а operandNMultiplyFormat
-- отсутствует/пуст — проставляет 'addOne'.
--
-- sequences: jsonb вида { "<boq_item_type>": [ {шаг}, ... ], ... }.
-- Идемпотентно: повторный запуск не меняет уже проставленные значения.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.

BEGIN;

DO $$
DECLARE
    r            RECORD;
    new_seqs     jsonb;
    type_key     text;
    steps        jsonb;
    new_steps    jsonb;
    step         jsonb;
    new_step     jsonb;
    n            int;
    action_key   text;
    type_field   text;
    fmt_field    text;
    changed      boolean;
BEGIN
    FOR r IN SELECT id, sequences FROM public.markup_tactics LOOP
        new_seqs := r.sequences;
        changed  := false;

        FOR type_key IN SELECT jsonb_object_keys(r.sequences) LOOP
            steps := r.sequences -> type_key;
            IF jsonb_typeof(steps) <> 'array' THEN
                CONTINUE;
            END IF;

            new_steps := '[]'::jsonb;

            FOR step IN SELECT jsonb_array_elements(steps) LOOP
                new_step := step;

                FOR n IN 1..5 LOOP
                    action_key := 'action'  || n;
                    type_field := 'operand' || n || 'Type';
                    fmt_field  := 'operand' || n || 'MultiplyFormat';

                    IF (new_step ->> action_key) = 'multiply'
                       AND (new_step ->> type_field) = 'markup'
                       AND COALESCE(new_step ->> fmt_field, '') = '' THEN
                        new_step := jsonb_set(new_step, ARRAY[fmt_field], '"addOne"'::jsonb, true);
                        changed  := true;
                    END IF;
                END LOOP;

                new_steps := new_steps || jsonb_build_array(new_step);
            END LOOP;

            new_seqs := jsonb_set(new_seqs, ARRAY[type_key], new_steps, true);
        END LOOP;

        IF changed THEN
            UPDATE public.markup_tactics
               SET sequences = new_seqs,
                   updated_at = NOW()
             WHERE id = r.id;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- ── Read-only verification query (выполнить ОТДЕЛЬНО после применения) ──
-- Находит все multiply+markup операнды, у которых operandNMultiplyFormat
-- отсутствует/пуст ЛИБО имеет недопустимое значение (не addOne/direct).
-- Корректный результат после миграции: 0 строк.
--
-- SELECT mt.id::text AS tactic_id,
--        mt.name,
--        tk        AS category,
--        (st.ord - 1) AS step_idx,
--        n         AS operand,
--        st.step ->> ('operand' || n || 'MultiplyFormat') AS multiply_format
-- FROM public.markup_tactics mt
-- CROSS JOIN LATERAL jsonb_object_keys(mt.sequences) AS tk
-- CROSS JOIN LATERAL jsonb_array_elements(mt.sequences -> tk)
--                    WITH ORDINALITY AS st(step, ord)
-- CROSS JOIN generate_series(1, 5) AS n
-- WHERE jsonb_typeof(mt.sequences -> tk) = 'array'
--   AND (st.step ->> ('action'  || n)) = 'multiply'
--   AND (st.step ->> ('operand' || n || 'Type')) = 'markup'
--   AND COALESCE(st.step ->> ('operand' || n || 'MultiplyFormat'), '')
--         NOT IN ('addOne', 'direct')
-- ORDER BY mt.name, tk, step_idx, operand;
