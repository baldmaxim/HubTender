-- Проверка данных: вердикты инженера по находкам правил.
--
-- Контекст: страница «Проверка данных» гоняет каталог правил (docs/data-quality/)
-- и показывает находки. Инженер помечает каждую как 'error' (реальная ошибка) или
-- 'accepted' (легитимный случай — например, оборудование комплектом у ЖК Cityzen,
-- где ГП=1 при работе 217 и это верно).
--
-- fingerprint — md5 значимых значений находки, его считает SQL самого правила.
-- Вердикт действует, пока отпечаток совпадает: поменялись количество, цена или
-- коэффициент — отпечаток другой, находка всплывает заново. Без этого однажды
-- «принятая» строка молчала бы навсегда, даже когда реально сломается.
--
-- Уникальность по (tender_id, rule_code, entity_id): на одну сущность в рамках
-- правила — один действующий вердикт, он перезаписывается при смене решения.
--
-- Из этой таблицы считается точность правила: ошибки / (ошибки + принято).
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quality_acknowledgements (
    id           uuid        NOT NULL DEFAULT gen_random_uuid(),
    tender_id    uuid        NOT NULL,
    rule_code    text        NOT NULL,
    entity_id    uuid        NOT NULL,
    fingerprint  text        NOT NULL,
    verdict      text        NOT NULL,
    note         text,
    created_by   uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quality_acknowledgements_pkey PRIMARY KEY (id),
    CONSTRAINT quality_acknowledgements_verdict_check
        CHECK (verdict IN ('accepted', 'error')),
    CONSTRAINT quality_acknowledgements_tender_fkey
        FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE
);

-- Один действующий вердикт на сущность в рамках правила.
CREATE UNIQUE INDEX IF NOT EXISTS quality_acknowledgements_unique_idx
    ON public.quality_acknowledgements (tender_id, rule_code, entity_id);

-- Основной путь чтения: находки одного тендера джойнятся с вердиктами.
CREATE INDEX IF NOT EXISTS quality_acknowledgements_tender_idx
    ON public.quality_acknowledgements (tender_id);

DROP TRIGGER IF EXISTS quality_acknowledgements_updated_at
    ON public.quality_acknowledgements;
CREATE TRIGGER quality_acknowledgements_updated_at
    BEFORE UPDATE ON public.quality_acknowledgements
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
