-- =============================================================================
-- 2026_06_financial_approval.sql
--
-- Добавляет статус согласования «Финансовых показателей», привязанный к версии
-- тендера. Каждая версия — отдельная строка public.tenders (общий tender_number,
-- свой version), поэтому статус хранится колонками на самой строке tenders.
--
--   financial_approved     — false = «Не согласовано», true = «Согласовано»;
--   financial_approved_by  — кто согласовал (Генеральный директор);
--   financial_approved_at  — когда.
--
-- Согласование необратимо (откат не предусмотрен бизнес-логикой). Новая версия,
-- создаваемая public.clone_tender_as_new_version, вставляет tenders ЯВНЫМ списком
-- колонок — эти три в него не входят, поэтому копия получает DEFAULT (false =
-- «Не согласовано»). Менять функцию клонирования не нужно.
--
-- Идемпотентен (ADD COLUMN IF NOT EXISTS).
-- Применять к Yandex (DSN из .env.prod), НЕ к legacy Supabase.
-- =============================================================================

BEGIN;

ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS financial_approved    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financial_approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS financial_approved_at timestamptz;

COMMIT;
