-- «Объекты на карте»: фотографии объектов хранятся в БД (bytea).
--
-- construction_object_photos — фото объекта: полное (уже сжатое браузером,
--   до 1,5 МБ) и миниатюра (до 200 КБ). Байты отдаются отдельным запросом
--   /api/v1/construction-object-photos/{id}/image, списки их не читают.
--   Удаление объекта удаляет и его фото (ON DELETE CASCADE).
--
-- Идемпотентно: повторный запуск безопасен.
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

CREATE TABLE IF NOT EXISTS public.construction_object_photos (
    id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    object_id   uuid         NOT NULL,
    mime        text         NOT NULL,
    content     bytea        NOT NULL,
    thumb_mime  text         NOT NULL,
    thumb       bytea        NOT NULL,
    width       integer      NOT NULL,
    height      integer      NOT NULL,
    size_bytes  integer      NOT NULL,
    caption     text,
    sort_order  integer      NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  uuid,
    CONSTRAINT construction_object_photos_pkey PRIMARY KEY (id),
    CONSTRAINT construction_object_photos_object_fkey
        FOREIGN KEY (object_id) REFERENCES public.construction_objects(id) ON DELETE CASCADE,
    CONSTRAINT construction_object_photos_mime_check
        CHECK (mime IN ('image/jpeg', 'image/webp', 'image/png')),
    CONSTRAINT construction_object_photos_thumb_mime_check
        CHECK (thumb_mime IN ('image/jpeg', 'image/webp', 'image/png'))
);

COMMENT ON TABLE public.construction_object_photos IS 'Фотографии объектов строительства (байты в БД)';
COMMENT ON COLUMN public.construction_object_photos.object_id IS 'Объект (construction_objects); при удалении объекта фото удаляются';
COMMENT ON COLUMN public.construction_object_photos.mime IS 'Тип полного изображения: jpeg, webp или png';
COMMENT ON COLUMN public.construction_object_photos.content IS 'Полное изображение (сжато браузером, до 1,5 МБ)';
COMMENT ON COLUMN public.construction_object_photos.thumb_mime IS 'Тип миниатюры: jpeg, webp или png';
COMMENT ON COLUMN public.construction_object_photos.thumb IS 'Миниатюра (до 200 КБ)';
COMMENT ON COLUMN public.construction_object_photos.width IS 'Ширина полного изображения, px';
COMMENT ON COLUMN public.construction_object_photos.height IS 'Высота полного изображения, px';
COMMENT ON COLUMN public.construction_object_photos.size_bytes IS 'Размер полного изображения, байт';
COMMENT ON COLUMN public.construction_object_photos.caption IS 'Подпись к фото (необязательна)';
COMMENT ON COLUMN public.construction_object_photos.sort_order IS 'Порядок фото внутри объекта (первое — обложка)';
COMMENT ON COLUMN public.construction_object_photos.created_by IS 'Пользователь, загрузивший фото';

CREATE INDEX IF NOT EXISTS idx_construction_object_photos_object_sort
    ON public.construction_object_photos (object_id, sort_order);

COMMIT;
