-- Новые области машинного доступа для «Проверки данных» (конвейер проверки,
-- этап 6): внешний агент (Cursor и т.п.) по ключу читает находки и ставит
-- вердикты, не заходя в интерфейс.
--
--   verification:read  — GET /api/v1/tenders/{id}/quality, /quality/rules,
--                        /verification/sections, /cost-benchmarks, /benchmark-ranges,
--                        /brief;
--   verification:write — вердикты, «Проверка завершена», отметки разделов, PUT /brief.
--
-- Инварианты:
--   * ограничение ключа по allowed_tender_ids действует и здесь;
--   * CHECK перечисляет области явно — без этой миграции ключ с новыми
--     областями не вставится в api_keys, каким бы ни был Go-валидатор;
--   * миграция идемпотентна.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_chk') THEN
        ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_scopes_chk;
    END IF;

    ALTER TABLE public.api_keys
        ADD CONSTRAINT api_keys_scopes_chk
        CHECK (cardinality(scopes) > 0
               AND scopes <@ ARRAY['archive:read', 'archive:write', 'tenders:read', 'tenders:write',
                                   'verification:read', 'verification:write']::text[]);
END $$;
