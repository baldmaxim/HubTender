-- Область ключа nomenclature:write — POST /api/v1/nomenclature/ensure: машинный
-- ключ (авторасценка) находит или создаёт наименования работ и материалов.
--
-- Что меняется: CHECK api_keys_scopes_chk перечисляет области явно — без этой
-- миграции ключ с nomenclature:write не вставится в api_keys (выпуск вернёт 500).
-- Таблицы work_names / material_names не меняются.
--
-- Инварианты: существующие ключи и их области не трогаются; миграция идемпотентна.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок: эта миграция -> бэкенд -> фронтенд.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_chk') THEN
        ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_scopes_chk;
    END IF;

    ALTER TABLE public.api_keys
        ADD CONSTRAINT api_keys_scopes_chk
        CHECK (cardinality(scopes) > 0
               AND scopes <@ ARRAY['archive:read', 'archive:write', 'tenders:read', 'tenders:write',
                                   'verification:read', 'verification:write',
                                   'registry:read', 'registry:write',
                                   'verification:telegram',
                                   'nomenclature:write']::text[]);
END $$;

COMMIT;
