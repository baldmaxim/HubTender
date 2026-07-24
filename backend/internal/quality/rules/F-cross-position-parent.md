---
code: F
title: Материал привязан к работе из другой позиции
severity: error
money: no
status: active
---
## Суть

**Страж регресса.** На проде даёт ноль и должен оставаться нулевым.

Материал ссылается на работу, которая лежит в другой позиции заказчика. Это
структурно недопустимо: привязка существует, чтобы выводить количество материала из
работы внутри одной позиции. Ссылка через границу позиции означает, что количество
материала считается от чужого объёма, а при удалении или переносе той позиции связь
превратится в висячую.

Возникнуть может при копировании позиций или переносе версий, если переотображение
идентификаторов отработало не полностью.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.parent_work_item_id::text, b.client_position_id::text)) AS fingerprint,
  concat_ws(' ',
    'Материал в позиции', cp.position_number::text,
    'привязан к работе из позиции', wcp.position_number::text) AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.boq_items w ON w.id = b.parent_work_item_id
JOIN public.client_positions cp  ON cp.id  = b.client_position_id
JOIN public.client_positions wcp ON wcp.id = w.client_position_id
WHERE b.tender_id = $1
  AND b.client_position_id <> w.client_position_id
ORDER BY cp.position_number
```

## Подтверждено

- TP: не зафиксировано (и не должно).
- FP: невозможен — привязка через границу позиции не имеет корректной интерпретации.

## Замер (2026-07-24)

0 строк. Инвариант держится.
