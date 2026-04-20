-- Baseline migration 1/10: extensions and ENUM types.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- =============================================================================
-- ENUM types (11 total, preserved exactly from live prod including Cyrillic labels).
-- =============================================================================

CREATE TYPE public.access_status_type AS ENUM ('pending', 'approved', 'blocked');

CREATE TYPE public.boq_item_type AS ENUM ('мат', 'суб-мат', 'мат-комп.', 'раб', 'суб-раб', 'раб-комп.');

CREATE TYPE public.construction_scope_type AS ENUM ('генподряд', 'коробка', 'монолит');

CREATE TYPE public.currency_type AS ENUM ('RUB', 'USD', 'EUR', 'CNY');

CREATE TYPE public.delivery_price_type AS ENUM ('в цене', 'не в цене', 'суммой');

CREATE TYPE public.housing_class_type AS ENUM ('комфорт', 'бизнес', 'премиум', 'делюкс');

CREATE TYPE public.material_type AS ENUM ('основн.', 'вспомогат.');

CREATE TYPE public.task_status AS ENUM ('running', 'paused', 'completed');

CREATE TYPE public.user_role_type AS ENUM ('Руководитель', 'Администратор', 'Разработчик', 'Старший группы', 'Инженер');

CREATE TYPE public.work_mode AS ENUM ('office', 'remote');

CREATE TYPE public.work_status AS ENUM ('working', 'not_working');
