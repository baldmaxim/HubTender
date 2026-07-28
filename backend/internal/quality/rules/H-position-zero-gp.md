---
code: H
title: У позиции есть строки, но не задано Количество ГП
severity: warning
money: no
status: active
---
## Суть

В позицию уже занесены работы и материалы, а её собственное «Количество ГП»
(`manual_volume`) осталось нулевым или пустым.

Это не только незаполненное поле: объём позиции — база для непривязанных материалов.
При добавлении материала система берёт его количество из объёма позиции, и при нуле
подставляет единицу (ноль запрещён ограничением БД). То есть незаполненный объём
молча превращается в количество «1» у новых материалов.

## SQL

```sql
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', COALESCE(cp.manual_volume, 0), COALESCE(cp.volume, 0), COUNT(b.id))) AS fingerprint,
  concat_ws(' ',
    'Кол-во ГП позиции не задано, при этом строк:', COUNT(b.id)::text,
    '; количество заказчика:', COALESCE(round(cp.volume, 4)::text, 'тоже не задано')) AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
JOIN public.boq_items b ON b.client_position_id = cp.id
WHERE cp.tender_id = $1
  AND COALESCE(cp.manual_volume, 0) = 0
GROUP BY cp.tender_id, cp.position_number, cp.item_no, cp.id, cp.manual_volume, cp.volume
ORDER BY cp.position_number
```

## Подтверждено

- TP: 929 позиций в 35 тендерах — строки внесены, объём не проставлен.
- FP: возможен для позиций-разделов, куда строки попали ошибочно. Проверяется глазами.

## Замер (2026-07-24)

929 позиций в 35 тендерах.
