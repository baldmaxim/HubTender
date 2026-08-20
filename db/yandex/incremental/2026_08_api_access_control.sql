-- Управление машинным доступом к API (страница «Настройки → Доступ к API»).
--
-- Инварианты:
--   * PLAINTEXT-ключ в БД ЗАПРЕЩЁН. Хранится только SHA-256 хеш полного секрета;
--     сам секрет показывается пользователю ОДИН раз при выпуске и больше нигде
--     не восстанавливается (в том числе из бэкапа).
--   * key_prefix — первые символы ключа для опознания в списке, НЕ секрет.
--   * Ключ действует ОТ ИМЕНИ пользователя-владельца (created_by): аудит
--     boq_items_audit.changed_by ссылается на users(id), анонимной записи быть
--     не может.
--   * Область ключа ограничивается scopes (archive:read / archive:write) и,
--     опционально, списком разрешённых тендеров для записи.
--   * api_access_settings — одна строка (id = true): тумблеры эндпоинтов и
--     потолки. Значения по умолчанию совпадают с зашитыми в коде.
--   * api_call_log хранит только метаданные вызова: ни тел запросов, ни
--     секретов, ни ключа в открытом виде.
--   * Миграция idempotent и additive.

CREATE TABLE IF NOT EXISTS public.api_keys (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    key_prefix         text NOT NULL,
    key_hash           text NOT NULL,
    scopes             text[] NOT NULL DEFAULT '{}',
    allowed_tender_ids uuid[],
    expires_at         timestamp with time zone,
    revoked_at         timestamp with time zone,
    revoked_by         uuid,
    last_used_at       timestamp with time zone,
    created_at         timestamp with time zone NOT NULL DEFAULT now(),
    updated_at         timestamp with time zone NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_key_hash_uniq') THEN
        ALTER TABLE public.api_keys
            ADD CONSTRAINT api_keys_key_hash_uniq UNIQUE (key_hash);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_created_by_fkey') THEN
        ALTER TABLE public.api_keys
            ADD CONSTRAINT api_keys_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES public.users(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_revoked_by_fkey') THEN
        ALTER TABLE public.api_keys
            ADD CONSTRAINT api_keys_revoked_by_fkey
            FOREIGN KEY (revoked_by) REFERENCES public.users(id);
    END IF;

    -- Пустой набор прав бессмысленен: ключ, который ничего не может, только
    -- создаёт иллюзию доступа.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scopes_chk') THEN
        ALTER TABLE public.api_keys
            ADD CONSTRAINT api_keys_scopes_chk
            CHECK (cardinality(scopes) > 0
                   AND scopes <@ ARRAY['archive:read', 'archive:write']::text[]);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_name_chk') THEN
        ALTER TABLE public.api_keys
            ADD CONSTRAINT api_keys_name_chk
            CHECK (length(btrim(name)) BETWEEN 1 AND 120);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON public.api_keys (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON public.api_keys (created_by);

-- ─── Тумблеры и потолки (одна строка) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_access_settings (
    id                      boolean PRIMARY KEY DEFAULT true,
    archive_search_enabled  boolean NOT NULL DEFAULT true,
    archive_read_enabled    boolean NOT NULL DEFAULT true,
    archive_suggest_enabled boolean NOT NULL DEFAULT true,
    archive_compose_enabled boolean NOT NULL DEFAULT true,
    max_search_limit        integer NOT NULL DEFAULT 200,
    max_candidate_limit     integer NOT NULL DEFAULT 4000,
    max_suggest_queries     integer NOT NULL DEFAULT 100,
    rate_limit_per_minute   integer NOT NULL DEFAULT 120,
    call_log_retention_days integer NOT NULL DEFAULT 30,
    updated_at              timestamp with time zone NOT NULL DEFAULT now(),
    updated_by              uuid
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_access_settings_singleton_chk') THEN
        ALTER TABLE public.api_access_settings
            ADD CONSTRAINT api_access_settings_singleton_chk CHECK (id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_access_settings_limits_chk') THEN
        ALTER TABLE public.api_access_settings
            ADD CONSTRAINT api_access_settings_limits_chk
            CHECK (max_search_limit BETWEEN 1 AND 1000
               AND max_candidate_limit BETWEEN 50 AND 20000
               AND max_suggest_queries BETWEEN 1 AND 500
               AND rate_limit_per_minute BETWEEN 0 AND 100000
               AND call_log_retention_days BETWEEN 1 AND 365);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_access_settings_updated_by_fkey') THEN
        ALTER TABLE public.api_access_settings
            ADD CONSTRAINT api_access_settings_updated_by_fkey
            FOREIGN KEY (updated_by) REFERENCES public.users(id);
    END IF;
END $$;

INSERT INTO public.api_access_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- ─── Журнал вызовов (только метаданные) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_call_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id      uuid,
    user_id         uuid,
    method          text NOT NULL,
    path            text NOT NULL,
    status          integer NOT NULL,
    duration_ms     integer NOT NULL DEFAULT 0,
    error_code      text,
    items_affected  integer,
    dry_run         boolean,
    called_at       timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_call_log_api_key_fkey') THEN
        ALTER TABLE public.api_call_log
            ADD CONSTRAINT api_call_log_api_key_fkey
            FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_call_log_user_fkey') THEN
        ALTER TABLE public.api_call_log
            ADD CONSTRAINT api_call_log_user_fkey
            FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_call_log_called_at ON public.api_call_log (called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_call_log_api_key ON public.api_call_log (api_key_id, called_at DESC);
