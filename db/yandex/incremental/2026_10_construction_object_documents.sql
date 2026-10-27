-- «Объекты на карте»: документы объектов (разрешения на ввод и т.п.) хранятся в БД (bytea).
--
-- construction_object_documents — PDF и сканы (JPEG/PNG/TIFF/WebP) до 25 МБ,
--   не больше 50 штук на объект (лимит проверяет бэкенд). Байты отдаются
--   отдельным запросом /api/v1/construction-object-documents/{id}/file,
--   списки и счётчик document_count их не читают.
--   Удаление объекта удаляет и его документы (ON DELETE CASCADE).
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.construction_object_documents (
    id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    object_id   uuid         NOT NULL,
    file_name   text         NOT NULL,
    mime        text         NOT NULL,
    content     bytea        NOT NULL,
    size_bytes  integer      NOT NULL,
    title       text,
    doc_date    date,
    sort_order  integer      NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  uuid,
    CONSTRAINT construction_object_documents_pkey PRIMARY KEY (id),
    CONSTRAINT construction_object_documents_object_fkey
        FOREIGN KEY (object_id) REFERENCES public.construction_objects(id) ON DELETE CASCADE,
    CONSTRAINT construction_object_documents_mime_check
        CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp'))
);

COMMENT ON TABLE public.construction_object_documents IS 'Документы объектов строительства: разрешения на ввод и т.п. (байты в БД)';
COMMENT ON COLUMN public.construction_object_documents.object_id IS 'Объект (construction_objects); при удалении объекта документы удаляются';
COMMENT ON COLUMN public.construction_object_documents.file_name IS 'Имя загруженного файла (без пути, до 200 символов)';
COMMENT ON COLUMN public.construction_object_documents.mime IS 'Тип файла по его байтам: pdf, jpeg, png, tiff или webp';
COMMENT ON COLUMN public.construction_object_documents.content IS 'Содержимое файла (до 25 МБ)';
COMMENT ON COLUMN public.construction_object_documents.size_bytes IS 'Размер файла, байт';
COMMENT ON COLUMN public.construction_object_documents.title IS 'Название документа (необязательно, до 300 символов)';
COMMENT ON COLUMN public.construction_object_documents.doc_date IS 'Дата документа (необязательна)';
COMMENT ON COLUMN public.construction_object_documents.sort_order IS 'Порядок документов внутри объекта';
COMMENT ON COLUMN public.construction_object_documents.created_by IS 'Пользователь, загрузивший документ';

CREATE INDEX IF NOT EXISTS idx_construction_object_documents_object_sort
    ON public.construction_object_documents (object_id, sort_order);

COMMIT;
