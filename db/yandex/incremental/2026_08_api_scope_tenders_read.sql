-- Новая область машинного доступа: tenders:read — чтение списка позиций тендера
-- (GET /api/v1/tenders/{id}/positions). Нужна, чтобы внешний код мог сопоставить
-- «код строки → UUID позиции» перед сборкой сметы в существующие позиции.
--
-- Инварианты:
--   * область даёт ТОЛЬКО чтение списка позиций; записи в тендер она не открывает;
--   * ограничение ключа по allowed_tender_ids действует и здесь;
--   * CHECK перечисляет области явно — без этой миграции ключ с tenders:read
--     не вставится в api_keys, каким бы ни был Go-валидатор.
--   * Миграция idempotent.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_chk') THEN
        ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_scopes_chk;
    END IF;

    ALTER TABLE public.api_keys
        ADD CONSTRAINT api_keys_scopes_chk
        CHECK (cardinality(scopes) > 0
               AND scopes <@ ARRAY['archive:read', 'archive:write', 'tenders:read']::text[]);
END $$;
