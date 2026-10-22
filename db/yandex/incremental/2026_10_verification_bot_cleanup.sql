-- Бот рассылки замечаний «Проверки данных» — шаг 2 из 2: очистка после
-- замены встроенного бота внешним (2026_10_verification_bot_external.sql).
--
-- Внешний бот — новый бот у BotFather: старые привязки к чатам со старым
-- ботом недействительны, а сообщения старого бота в очереди ему не принадлежат.
-- Поэтому:
--   * telegram_links и telegram_link_tokens очищаются — пользователи привяжут
--     Telegram заново (меню профиля → «Telegram»);
--   * у элементов неотправленных (pending) сообщений снимается dedup_key —
--     иначе эти находки нельзя было бы отправить повторно, а сами сообщения
--     закрываются как skipped: адресатов больше нет;
--   * столбец telegram_bot_state.update_offset (offset long polling старого
--     бота) удаляется.
--
-- Инварианты:
--   * весь блок выполняется только пока update_offset существует: повторный
--     запуск — no-op и не сносит привязки, сделанные уже новым ботом;
--   * миграция идемпотентна.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок: 2026_10_verification_bot_external.sql → бэкенд → фронтенд → эта
-- миграция, ДО первого запуска бота на офисном ПК.

DO $$
BEGIN
    IF EXISTS (SELECT 1
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'telegram_bot_state'
                 AND column_name = 'update_offset') THEN
        DELETE FROM public.telegram_link_tokens;
        DELETE FROM public.telegram_links;

        UPDATE public.verification_notification_items
        SET dedup_key = NULL
        WHERE notification_id IN (SELECT id FROM public.verification_notifications WHERE status = 'pending');

        UPDATE public.verification_notifications
        SET status = 'skipped', last_error = 'бот заменён внешним (офисный ПК)'
        WHERE status = 'pending';

        ALTER TABLE public.telegram_bot_state DROP COLUMN update_offset;
    END IF;
END $$;
