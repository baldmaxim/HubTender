-- UI-управление OpenRouter API-ключом (feature/ai-key-ui).
--
-- Инварианты:
--   * PLAINTEXT-ключ в БД ЗАПРЕЩЁН по-прежнему. Хранится ТОЛЬКО шифротекст
--     AES-256-GCM; ключ шифрования производен от серверного JWT-private-key
--     (backend/internal/ai/keycrypt) и в БД/бэкапы не попадает — восстановленный
--     в другом окружении бэкап содержит бесполезный шифротекст.
--   * api_key_suffix — последние 4 символа для отображения в UI (не секрет).
--   * Приоритет источников на runtime: UI-ключ (БД) > env OPENROUTER_API_KEY.
--   * Миграция idempotent; additive; nullable — совместима со старым backend.

ALTER TABLE public.ai_feature_settings
    ADD COLUMN IF NOT EXISTS api_key_ciphertext bytea,
    ADD COLUMN IF NOT EXISTS api_key_suffix text,
    ADD COLUMN IF NOT EXISTS api_key_set_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS api_key_set_by uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feature_settings_api_key_suffix_chk') THEN
        ALTER TABLE public.ai_feature_settings ADD CONSTRAINT ai_feature_settings_api_key_suffix_chk
            CHECK (api_key_suffix IS NULL OR length(api_key_suffix) <= 8);
    END IF;
END $$;
