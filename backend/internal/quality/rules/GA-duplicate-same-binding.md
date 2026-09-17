---
code: GA
title: Дубль материала при той же работе и той же категории затрат
severity: warning
money: yes
status: active
entity_type: boq_item
---
## Суть

В позиции один и тот же материал (справочник + цена) заведён несколько раз **при
одинаковой привязке к работе и одинаковой детальной категории затрат**.

Заменяет правило **G** (выключено). Широкий G ловил и законные повторы: краска / растворитель
под разными работами, стеклопакеты в разных примыканиях. На «Большой Татарской» G дал
108 групп и ~94 млн ₽ «сверху», из них десятки — такие FP.

GA оставляет кандидатов на импортное задвоение: две строки с одним смыслом и одной
привязкой. Денежный эффект по-прежнему оценка сверху (сумма минус одна строка).

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  (array_agg(b.id ORDER BY b.id))[1] AS entity_id,
  md5(concat_ws('|',
    b.material_name_id::text,
    trim_scale(b.unit_rate),
    COALESCE(b.parent_work_item_id::text, ''),
    COALESCE(b.detail_cost_category_id::text, ''),
    COUNT(*)::text)) AS fingerprint,
  concat_ws(' ',
    'Материал', COALESCE(MIN(mn.name), '(без справочника)'),
    'заведён', COUNT(*)::text, 'раз с одной привязкой и ценой',
    round(COALESCE(b.unit_rate, 0), 2)::text, '₽; суммарно',
    round(SUM(COALESCE(b.total_amount, 0)), 2)::text, '₽') AS detail,
  round(SUM(COALESCE(b.total_amount, 0)) - MAX(COALESCE(b.total_amount, 0)), 2) AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
WHERE b.tender_id = $1
  AND b.material_name_id IS NOT NULL
GROUP BY b.tender_id, cp.position_number, cp.item_no, b.client_position_id,
         b.material_name_id, b.unit_rate,
         b.parent_work_item_id, b.detail_cost_category_id
HAVING COUNT(*) > 1
ORDER BY SUM(COALESCE(b.total_amount, 0)) - MAX(COALESCE(b.total_amount, 0)) DESC
```

## Подтверждено

- FP: «Большая Татарская» v2, поз. 795 и 1630–1632 — ТЕХНОФАС ОПТИМА двумя слоями
  (коэффициенты перевода 0.05 и 0.1, в сумме 150 мм, как в строке заказчика); поз. 124,
  126, 818, 819 — уайт-спирит с коэффициентами 0.0079 и 0.4878 на разные операции.
  Проверяющий подтвердил все 8 групп как норму.
- Коэффициенты в ключ группировки **не добавлены** намеренно: обычно разные коэффициенты
  означают разные слои, но бывают и настоящие дубли с разными коэффициентами. Отличать
  такие случаи по смыслу строк — задача ИИ-разбора находок (см. README), а не SQL.
- FP (отсечены): краска ПФ-115, уайт-спирит и стеклопакеты под разными работами — в G
  на Татарской было 108 групп, в GA осталось 8.
- Двери KTV-3A-3600 (поз. 335/338/349/355/589/591) в GA не попали: у строк разные работы
  или категории затрат, то есть это не импортный дубль.

## Замер (2026-09-16)

База 105 тендеров: **2 000 групп в 84 тендерах**, оценка сверху 1.14 млрд ₽ (у G — 11 886
групп в 99 тендерах и 4.5 млрд ₽). На «Большой Татарской» v2 — 8 групп и 1.8 млн ₽
(у G — 108 и 94 млн ₽).
