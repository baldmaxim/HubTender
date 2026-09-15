-- Конвейер проверки расчёта: рассылка замечаний исполнителям в Telegram.
--
-- Проверяющий на «Проверке данных» выбирает находки и нажимает «Отправить
-- исполнителям». Адресат находки — автор последней правки строки (или самый
-- частый автор строк позиции) по boq_items_audit; не нашёлся — сам отправивший.
-- Автоматической рассылки нет.
--
-- telegram_links         — привязка пользователя TenderHUB к личному чату с ботом.
-- telegram_link_tokens   — одноразовые токены привязки (/start <токен>, 15 минут);
--                          хранится только sha256 токена.
-- telegram_bot_state     — offset long polling getUpdates (одна строка).
-- verification_notifications       — очередь сообщений (outbox), одно сообщение —
--                                    до 10 находок одному адресату.
-- verification_notification_items  — находки в сообщении. dedup_key не даёт
--                                    отправить ту же находку с тем же отпечатком
--                                    тому же адресату повторно; у неотправленных
--                                    (failed/skipped) он обнуляется.
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_links (
    user_id           uuid        NOT NULL,
    chat_id           bigint      NOT NULL,
    telegram_username text,
    linked_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT telegram_links_pkey PRIMARY KEY (user_id),
    CONSTRAINT telegram_links_chat_key UNIQUE (chat_id),
    CONSTRAINT telegram_links_user_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    token_hash text        NOT NULL,
    user_id    uuid        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT telegram_link_tokens_pkey PRIMARY KEY (token_hash),
    CONSTRAINT telegram_link_tokens_user_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx
    ON public.telegram_link_tokens (user_id);

CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
    id            smallint    NOT NULL DEFAULT 1,
    update_offset bigint      NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT telegram_bot_state_pkey PRIMARY KEY (id),
    CONSTRAINT telegram_bot_state_single_check CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS public.verification_notifications (
    id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id           uuid        NOT NULL,
    recipient_user_id   uuid        NOT NULL,
    created_by          uuid,
    status              text        NOT NULL DEFAULT 'pending',
    attempts            integer     NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NOT NULL DEFAULT now(),
    last_error          text,
    telegram_message_id bigint,
    created_at          timestamptz NOT NULL DEFAULT now(),
    sent_at             timestamptz,
    CONSTRAINT verification_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT verification_notifications_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    CONSTRAINT verification_notifications_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE,
    CONSTRAINT verification_notifications_recipient_fkey
        FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS verification_notifications_pending_idx
    ON public.verification_notifications (next_attempt_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS verification_notifications_tender_idx
    ON public.verification_notifications (tender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.verification_notification_items (
    id                uuid        NOT NULL DEFAULT gen_random_uuid(),
    notification_id   uuid        NOT NULL,
    finding_id        uuid        NOT NULL,
    recipient_user_id uuid        NOT NULL,
    fingerprint       text        NOT NULL,
    resolver          text        NOT NULL,
    dedup_key         text,
    verdict           text,
    verdict_at        timestamptz,
    CONSTRAINT verification_notification_items_pkey PRIMARY KEY (id),
    CONSTRAINT verification_notification_items_resolver_check
        CHECK (resolver IN ('item_author', 'position_author', 'sender')),
    CONSTRAINT verification_notification_items_verdict_check
        CHECK (verdict IS NULL OR verdict IN ('accepted', 'error')),
    CONSTRAINT verification_notification_items_notification_fkey
        FOREIGN KEY (notification_id) REFERENCES public.verification_notifications(id) ON DELETE CASCADE,
    CONSTRAINT verification_notification_items_finding_fkey
        FOREIGN KEY (finding_id) REFERENCES public.verification_findings(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_notification_items_dedup_idx
    ON public.verification_notification_items (dedup_key);
CREATE INDEX IF NOT EXISTS verification_notification_items_notification_idx
    ON public.verification_notification_items (notification_id);
CREATE INDEX IF NOT EXISTS verification_notification_items_finding_idx
    ON public.verification_notification_items (finding_id);

-- Вердикт из Telegram пишется в историю находки с source = 'telegram' —
-- значение уже разрешено CHECK verification_finding_events_source_check.

COMMIT;
