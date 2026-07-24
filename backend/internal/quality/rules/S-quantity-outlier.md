---
code: S
title: Количество материала в сотни раз превышает объём позиции
severity: warning
money: no
status: active
---
## Суть

Количество материала более чем в 100 раз больше объёма позиции, в которой он лежит.
Обычно это либо ошибка порядка при вводе, либо коэффициент, применённый не к той
величине.

Иногда законно: материал измеряется в мелких единицах при позиции в крупных
(штуки метизов на кубометр кладки, граммы на тонну). Поэтому severity `warning` —
правило показывает кандидатов, а не выносит приговор.

Порог 100× выбран как заведомо консервативный: обычные пересчёты единиц дают
кратность в десятки, а не в сотни.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.quantity, cp.manual_volume, b.unit_rate)) AS fingerprint,
  concat_ws(' ',
    'Количество ГП', round(COALESCE(b.quantity, 0), 4)::text,
    'при объёме позиции', round(COALESCE(cp.manual_volume, 0), 4)::text,
    '— кратность',
    round(COALESCE(b.quantity, 0) / NULLIF(cp.manual_volume, 0), 1)::text || '×') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.boq_item_type::text LIKE '%мат%'
  AND COALESCE(cp.manual_volume, 0) > 0
  AND COALESCE(b.quantity, 0) > 100 * cp.manual_volume
ORDER BY COALESCE(b.quantity, 0) / NULLIF(cp.manual_volume, 0) DESC
```

## Подтверждено

- TP: 5 953 строки в 77 тендерах.
- FP: ожидается значительная доля — мелкоштучные материалы на крупный объём позиции
  дают законную кратность в сотни раз.

## Замер (2026-07-24)

5 953 строки в 77 тендерах.
