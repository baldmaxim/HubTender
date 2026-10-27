-- «Объекты на карте»: дом по программе реновации в составе ЖК «Дом 56» (27.10.2026).
-- Отдельный договор projects «ЖК Реновация» (тот же заказчик «СЗ Галс-Фридриха Энгельса»,
-- 5 586,7 м²): 9-этажный корпус на 56 квартир на площадке комплекса. Точка — рядом
-- с «Дом 56», чтобы пины не совпадали. Идемпотентно: вставка, только если объекта
-- с этим договором ещё нет.

BEGIN;

INSERT INTO public.construction_objects
  (name, area, address, customer, latitude, longitude, status, project_id, sort_order)
SELECT 'Дом по программе реновации (ЖК «Дом 56»)', 5586.7, 'Москва, ул. Фридриха Энгельса, 56',
       'ГАЛС-Девелопмент', 55.77745, 37.69305, 'current', p.id, 107
FROM public.projects p
WHERE p.name = 'ЖК Реновация'
  AND p.client_name ILIKE '%Галс-Фридриха Энгельса%'
  AND NOT EXISTS (SELECT 1 FROM public.construction_objects o WHERE o.project_id = p.id);

COMMIT;
