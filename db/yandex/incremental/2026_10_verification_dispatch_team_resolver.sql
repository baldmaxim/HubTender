-- Рассылка замечаний: резолвер «team» — адресат находки правила U целая команда.
--
-- Находки U («Позиция со строками без цен и без Кол-ва ГП») не имеют одного
-- виновного: их получают все участники команды «Хронологии» (Общестрой, Фасады,
-- Отделка, ЭОМ/СС, ОВиВК), отвечающей за раздел позиции. Источник адресата
-- пишется в verification_notification_items.resolver, поэтому в допустимые
-- значения добавляется 'team'.
--
-- Инварианты:
--   * прочие правила адресуются прежним порядком (item_author → position_author → sender);
--   * существующие строки остаются валидными;
--   * миграция идемпотентна.
--
-- Порядок: эта миграция → бэкенд. На production применена 22.10.2026.

BEGIN;

ALTER TABLE public.verification_notification_items
    DROP CONSTRAINT IF EXISTS verification_notification_items_resolver_check;
ALTER TABLE public.verification_notification_items
    ADD CONSTRAINT verification_notification_items_resolver_check
    CHECK (resolver IN ('item_author', 'position_author', 'sender', 'team'));

COMMIT;
