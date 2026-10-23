-- «Объекты на карте»: заказчик (девелопер) объекта и дата ввода первого этапа
-- (комплекс, вводившийся очередями: commissioning_start_date — первый ввод,
-- commissioning_date — последний). Идемпотентно.
-- Порядок выкатки: миграция → бэкенд → фронтенд.

BEGIN;

ALTER TABLE public.construction_objects ADD COLUMN IF NOT EXISTS customer text;
ALTER TABLE public.construction_objects ADD COLUMN IF NOT EXISTS commissioning_start_date date;

COMMENT ON COLUMN public.construction_objects.customer IS 'Заказчик / девелопер объекта';
COMMENT ON COLUMN public.construction_objects.commissioning_start_date IS
    'Дата ввода первого этапа (если вводился очередями); commissioning_date — последнего';

COMMIT;
