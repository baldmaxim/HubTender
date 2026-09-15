-- Конвейер проверки расчёта: краткая выжимка по тендеру для руководства.
--
-- Контекст: после проверки расчёта проверяющий выгружает «Финансовые показатели»
-- в Excel и пишет под таблицей выжимку — цена монолита за м³, какие фасады, какой
-- профиль витражей, есть ли разработка РД, почему объект дороже другого. Текст
-- жил в письме и терялся. Здесь он хранится по тендеру и попадает в выгрузку.
--
-- Цифры выжимки (₽ за единицу объёма и ₽ за м² по ключевым категориям) в таблице
-- не хранятся — их считает сервер из расчёта (cost-benchmarks), чтобы они не
-- расходились с тендером. Хранится только выбор категорий для выжимки
-- (fact_category_ids; NULL — крупнейшие категории автоматически) и текст.
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tender_briefs (
    tender_id         uuid        NOT NULL,
    summary_text      text        NOT NULL DEFAULT '',
    fact_category_ids uuid[],
    updated_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tender_briefs_pkey PRIMARY KEY (tender_id),
    CONSTRAINT tender_briefs_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS tender_briefs_updated_at ON public.tender_briefs;
CREATE TRIGGER tender_briefs_updated_at
    BEFORE UPDATE ON public.tender_briefs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
