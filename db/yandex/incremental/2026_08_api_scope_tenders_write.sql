-- Новая область машинного доступа: tenders:write — запись строк BOQ в позиции
-- тендера: POST /api/v1/tenders/{id}/positions/{posId}/items,
-- PATCH /api/v1/items/{id}, POST /api/v1/positions/{id}/recompute-totals.
--
-- Инварианты:
--   * ограничение ключа по allowed_tender_ids действует и здесь — для маршрутов
--     без id тендера в URL гейт резолвит тендер по строке/позиции;
--   * CHECK перечисляет области явно — без этой миграции ключ с tenders:write
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
               AND scopes <@ ARRAY['archive:read', 'archive:write', 'tenders:read', 'tenders:write']::text[]);
END $$;
