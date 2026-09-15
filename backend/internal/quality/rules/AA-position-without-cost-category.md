---
code: AA
title: В позиции ни у одной строки нет категории затрат
severity: warning
money: yes
status: active
entity_type: client_position
---
## Суть

Позиция расценена, а категория затрат не проставлена ни у одной её строки.

Правило **N** ловит одиночную строку без категории и потому имеет severity `info`
— одна строка картину не портит. Здесь другое: позиция целиком выпадает из
разреза категорий, то есть её деньги есть в итоге тендера, но их нет ни в
«Затратах на строительство», ни в «Сравнении объектов».

Именно это делает сравнение с ранее посчитанным объектом незаметно неверным:
итоги сходятся, а разрез — нет, и разница списывается на «объекты разные».
Денежный эффект — та самая сумма, которая не видна в разрезе.

## SQL

```sql
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', trim_scale(round(SUM(b.total_amount), 2)),
                COUNT(b.id)::text)) AS fingerprint,
  concat_ws(' ',
    'Позиция на', round(SUM(b.total_amount), 2)::text,
    '₽ не попадает в разрез категорий затрат; строк:', COUNT(b.id)::text) AS detail,
  round(SUM(b.total_amount), 2) AS money_delta
FROM public.client_positions cp
JOIN public.boq_items b ON b.client_position_id = cp.id
WHERE cp.tender_id = $1
GROUP BY cp.tender_id, cp.position_number, cp.item_no, cp.id
HAVING COUNT(b.detail_cost_category_id) = 0
   AND COALESCE(SUM(b.total_amount), 0) > 0
ORDER BY cp.position_number
```

`COUNT(b.detail_cost_category_id)` считает только непустые значения, поэтому ноль
здесь означает «ни у одной строки категории нет».

## Подтверждено

- TP: 8 позиций в 2 тендерах на 232 708 ₽, которые не видны в разрезе категорий затрат.
- FP: не выявлены.

## Замер (2026-09-15)

База 104 тендера: **8 находок в 2 тендерах, 232 708 ₽** вне разреза категорий.
