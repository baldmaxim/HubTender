-- Бот рассылки замечаний «Проверки данных» — внешняя программа на офисном ПК
-- (api/VERIFICATION_BOT.md) вместо встроенного в бэкенд Telegram-бота
-- (2026_09_verification_telegram.sql).
--
--   verification:telegram — POST /api/v1/verification-bot/updates (обновления
--                           Telegram: привязка, /stop, кнопки вердикта),
--                           /verification-bot/claim (выдача очереди сообщений),
--                           /verification-bot/notifications/{id}/result (итог
--                           отправки).
--
-- Что меняется:
--   * telegram_bot_state получает bot_username и last_seen_at: имя бота нужно
--     для ссылки привязки t.me/<имя>, время последнего claim — для признака
--     «бот в сети» (моложе 90 с). Сервер больше не опрашивает Telegram, поэтому
--     update_offset ему не нужен — столбец снимает 2026_10_verification_bot_cleanup.sql;
--   * CHECK api_keys_scopes_chk перечисляет области явно — без этой миграции
--     ключ с verification:telegram не вставится в api_keys.
--
-- Инварианты:
--   * очередь verification_notifications, привязки и токены не трогаются —
--     старый бэкенд после этого шага работает дальше (шаг 1 из 2 только
--     добавляет);
--   * ключ, ограниченный списком тендеров, к боту не допускается: он рассылает
--     замечания по всем тендерам (гейт маршрута отвечает 403);
--   * миграция идемпотентна.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок: эта миграция → бэкенд → фронтенд → 2026_10_verification_bot_cleanup.sql

BEGIN;

ALTER TABLE public.telegram_bot_state
    ADD COLUMN IF NOT EXISTS bot_username text,
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

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
                                   'verification:telegram']::text[]);
END $$;

COMMIT;
