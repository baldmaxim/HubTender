-- Проверка данных: перенос вердиктов при разделении правил (разбор «Большой Татарской»).
--
-- С этого релиза ровные декады уходят из правил A и Y в новые AB и YD (severity error).
-- Вердикт хранится по (tender_id, rule_code, entity_id), поэтому находка, сменившая
-- код правила, потеряла бы решение инженера. Отпечатки у пар A/AB и Y/YD считаются
-- одинаково — копируем вердикт под новый код с тем же отпечатком. Если данные строки
-- с тех пор изменились, отпечаток не совпадёт с находкой и вердикт не подействует,
-- как и было бы в старом правиле.
--
-- Старые записи A/Y не удаляются: они больше не совпадают ни с одной находкой и
-- безвредны. G и Q выключены без замены вердиктов: у GA/QA другие отпечатки, а по
-- G и Q на проде вердиктов нет (замер 2026-09-16).
--
-- Условия декад повторяют SQL правил AB и YD. Идемпотентно (ON CONFLICT DO NOTHING).
--
-- ВНИМАНИЕ: НЕ применять к production вручную из кода. Применяет пользователь.
-- Порядок выкатки: бэкенд с новым каталогом правил → эта миграция (или наоборот —
-- записи под AB/YD до выката просто не используются).

BEGIN;

-- Y → YD: позиции, у которых Кол-во ГП отличается от заказчика ровно на порядок (±2%).
INSERT INTO public.quality_acknowledgements
    (tender_id, rule_code, entity_id, fingerprint, verdict, note, created_by)
SELECT qa.tender_id, 'YD', qa.entity_id, qa.fingerprint, qa.verdict, qa.note, qa.created_by
FROM public.quality_acknowledgements qa
JOIN public.client_positions cp ON cp.id = qa.entity_id
CROSS JOIN LATERAL (
    SELECT GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) AS ratio
    WHERE COALESCE(cp.volume, 0) > 0 AND COALESCE(cp.manual_volume, 0) > 0
) r
WHERE qa.rule_code = 'Y'
  AND cp.volume <> 1
  AND cp.manual_volume <> 1
  AND (   abs(r.ratio - 10)   / 10   < 0.02
       OR abs(r.ratio - 100)  / 100  < 0.02
       OR abs(r.ratio - 1000) / 1000 < 0.02)
ON CONFLICT (tender_id, rule_code, entity_id) DO NOTHING;

-- A → AB: привязанные материалы, отличающиеся от формулы ровно на порядок (±1%, без ГП = 1).
INSERT INTO public.quality_acknowledgements
    (tender_id, rule_code, entity_id, fingerprint, verdict, note, created_by)
SELECT qa.tender_id, 'AB', qa.entity_id, qa.fingerprint, qa.verdict, qa.note, qa.created_by
FROM public.quality_acknowledgements qa
JOIN public.boq_items b ON b.id = qa.entity_id
JOIN public.boq_items w ON w.id = b.parent_work_item_id
CROSS JOIN LATERAL (
    SELECT COALESCE(w.quantity, 0)
           * COALESCE(NULLIF(b.conversion_coefficient, 0), 1)
           * COALESCE(NULLIF(b.consumption_coefficient, 0), 1) AS formula
) f
WHERE qa.rule_code = 'A'
  AND f.formula > 0.01
  AND COALESCE(b.quantity, 0) > 0.01
  AND b.quantity <> 1
  AND (   abs(GREATEST(b.quantity / f.formula, f.formula / b.quantity) - 10)   / 10   < 0.01
       OR abs(GREATEST(b.quantity / f.formula, f.formula / b.quantity) - 100)  / 100  < 0.01
       OR abs(GREATEST(b.quantity / f.formula, f.formula / b.quantity) - 1000) / 1000 < 0.01)
ON CONFLICT (tender_id, rule_code, entity_id) DO NOTHING;

COMMIT;
