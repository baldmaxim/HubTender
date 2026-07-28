---
code: L
title: Доставка задана «суммой», но сумма нулевая
severity: error
money: no
status: active
---
## Суть

У строки выбран тип доставки «суммой» — значит стоимость доставки берётся из поля
`delivery_amount`. А там ноль или пусто. В расчёт итога доставка входит нулём, то есть
её как будто нет.

Это несогласованность заполнения: если доставка не оплачивается отдельно, тип должен
быть «в цене», а не «суммой» с нулём. Пока тип «суммой», итог строки занижен на
невыясненную величину — поэтому денежный эффект правило не оценивает.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.delivery_price_type::text, b.delivery_amount, b.unit_rate)) AS fingerprint,
  concat_ws(' ',
    'Тип доставки «суммой», но сумма доставки =',
    COALESCE(round(b.delivery_amount, 2)::text, 'не задана'),
    '; цена за единицу', round(COALESCE(b.unit_rate, 0), 2)::text, '₽') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.delivery_price_type::text = 'суммой'
  AND COALESCE(b.delivery_amount, 0) = 0
ORDER BY cp.position_number
```

## Подтверждено

- TP: 34 строки в 9 тендерах. Тип доставки выбран явно, значение не заполнено —
  сочетание не имеет смысла ни при каком сценарии.
- FP: не зафиксировано.

## Замер (2026-07-24)

34 строки в 9 тендерах.
