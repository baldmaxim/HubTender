---
code: GA
title: Дубль материала при той же работе и той же категории затрат
severity: warning
money: yes
status: draft
entity_type: boq_item
---
## Суть

В позиции один и тот же материал (справочник + цена) заведён несколько раз **при
одинаковой привязке к работе и одинаковой детальной категории затрат**.

Это сужение правила **G**. Широкий G ловит и законные повторы: краска / растворитель
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

- TP-кандидат: «Большая Татарская» — KTV-3A-3600 (карусельная дверь) по 2 строки в
  позициях 335/338/349/355/589/591; если parent и категория совпадают — импортный дубль
  или две одинаковые двери без различия в данных. Решает инженер по РД.
- FP, которые GA должен отсечь: краска ПФ-115 и уайт-спирит (17 групп в G) — обычно
  разные `parent_work_item_id`; стеклопакеты с одной ценой под разными работами.

## Замер

Черновик. Сравнить число GA vs G на всей базе и на «Большой Татарской».
Ожидание: GA ≪ 108 на этом тендере; краска/растворитель почти не попадают.
