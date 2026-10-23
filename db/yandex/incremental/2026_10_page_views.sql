-- Учёт просмотров страниц портала («Настройки → Использование портала»).
--
-- page_views — по строке на открытие страницы пользователем. page — путь-шаблон
-- страницы из реестра ('/analytics/quality', '/positions/:id'), без query и id.
-- Строки удаляются вместе с пользователем. Чистки по расписанию нет (MVP).
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.page_views (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    page      text        NOT NULL CHECK (length(page) BETWEEN 1 AND 200),
    viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at
    ON public.page_views (viewed_at);

COMMENT ON TABLE  public.page_views IS 'Просмотры страниц портала (для статистики использования)';
COMMENT ON COLUMN public.page_views.page IS 'Путь-шаблон страницы без query и id, например /positions/:id';

COMMIT;
