---
code: N
title: Строка не отнесена к категории затрат
severity: info
money: no
status: active
---
## Суть

У строки не заполнена детальная категория затрат (`detail_cost_category_id`). Сама по
себе сумма считается верно, но строка выпадает из всех разрезов по структуре затрат:
её не видно в распределении по категориям и в перераспределении затрат.

Severity `info`, а не ошибка: на деньги не влияет, но мешает аналитике.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.id::text, COALESCE(b.detail_cost_category_id::text, ''))) AS fingerprint,
  concat_ws(' ',
    'Строка типа', b.boq_item_type::text,
    'без категории затрат; сумма',
    round(COALESCE(b.total_amount, 0), 2)::text, '₽') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.detail_cost_category_id IS NULL
ORDER BY cp.position_number
```

## Подтверждено

- TP: 43 строки в 19 тендерах — единичные пропуски при заполнении.
- FP: не зафиксировано.

## Замер (2026-07-24)

43 строки в 19 тендерах.
