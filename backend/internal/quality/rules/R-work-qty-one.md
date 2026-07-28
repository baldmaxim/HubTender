---
code: R
title: Количество работы равно 1 при заметном объёме позиции
severity: warning
money: no
status: active
---
## Суть

У работы количество ровно 1, а объём позиции, в которой она лежит, больше 10.
Единица здесь выглядит как значение по умолчанию, которое забыли заменить настоящим
объёмом: система подставляет 1, когда объём не выводится (ноль запрещён ограничением БД).

Не всегда ошибка: работа действительно может быть комплексной, «за объект» — тогда 1
это корректная единица. Поэтому severity `warning`.

Важный побочный эффект: если к такой работе привязаны материалы, их количества
выводятся из этой единицы и получаются заниженными в разы.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.quantity, cp.manual_volume, b.unit_rate)) AS fingerprint,
  concat_ws(' ',
    'Работа с количеством 1 при объёме позиции',
    round(COALESCE(cp.manual_volume, 0), 4)::text,
    '; цена', round(COALESCE(b.unit_rate, 0), 2)::text, '₽') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.boq_item_type::text LIKE '%раб%'
  AND b.quantity = 1
  AND COALESCE(cp.manual_volume, 0) > 10
ORDER BY cp.position_number
```

## Подтверждено

- TP: «Река 4 v7», позиция 08.02.06 — объём позиции 89.47, а работы «Изготовление и
  монтаж металлоконструкций» и «примыкание кладки» стоят по 1. К ним привязаны 14
  материалов, чьи количества выведены из объёма позиции, а не из этой единицы, —
  из-за чего расходится правило **A**.
- FP: комплексные работы «за объект», где 1 — настоящая единица измерения.

## Замер (2026-07-24)

1 874 работы в 75 тендерах.
