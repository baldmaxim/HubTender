-- =============================================================================
-- 02_enums.sql — application ENUM types.
--
-- Source: supabase/migrations/00000000000001_baseline_extensions_and_enums.sql
-- (the CREATE EXTENSION lines from that migration are intentionally NOT ported —
-- pgcrypto / uuid-ossp are enabled at the Yandex cluster level).
--
-- 11 enums, Cyrillic labels preserved EXACTLY (data depends on them).
-- Wrapped in idempotent DO blocks (CREATE TYPE has no IF NOT EXISTS) so a
-- ranged --from/--to re-apply does not error on an already-built type.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.access_status_type AS ENUM ('pending', 'approved', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.boq_item_type AS ENUM ('мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.construction_scope_type AS ENUM ('генподряд', 'коробка', 'монолит');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.currency_type AS ENUM ('RUB', 'USD', 'EUR', 'CNY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_price_type AS ENUM ('в цене', 'не в цене', 'суммой');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.housing_class_type AS ENUM ('комфорт', 'бизнес', 'премиум', 'делюкс');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.material_type AS ENUM ('основн.', 'вспомогат.');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM ('running', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role_type AS ENUM ('Руководитель', 'Администратор', 'Разработчик', 'Старший группы', 'Инженер');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_mode AS ENUM ('office', 'remote');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_status AS ENUM ('working', 'not_working');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
