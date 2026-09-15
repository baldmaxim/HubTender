---
code: H
title: В позиции есть строки без денег, и не задано Количество ГП
severity: warning
money: no
status: active
entity_type: client_position
---
## Суть

С 2026-09-15 правило сужено до позиций, где строки есть, но их сумма нулевая: расценённые
позиции без Кол-ва ГП ловит правило **U** (error). Вместе H и U покрывают прежнее
пространство без пересечения.

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
  md5(concat_ws('|', trim_scale(COALESCE(cp.manual_volume, 0)),
                trim_scale(COALESCE(cp.volume, 0)), COUNT(b.id))) AS fingerprint,
  concat_ws(' ',
    'Кол-во ГП позиции не задано, при этом строк:', COUNT(b.id)::text,
    '; количество заказчика:', COALESCE(round(cp.volume, 4)::text, 'тоже не задано')) AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
JOIN public.boq_items b ON b.client_position_id = cp.id
WHERE cp.tender_id = $1
  AND COALESCE(cp.manual_volume, 0) = 0
GROUP BY cp.tender_id, cp.position_number, cp.item_no, cp.id, cp.manual_volume, cp.volume
HAVING COALESCE(SUM(b.total_amount), 0) = 0
ORDER BY cp.position_number
```

## Подтверждено

- TP: 929 позиций в 35 тендерах — строки внесены, объём не проставлен.
- FP: возможен для позиций-разделов, куда строки попали ошибочно. Проверяется глазами.

## Замер (2026-07-24)

929 позиций в 35 тендерах — до сужения.

## Замер (2026-09-15)

База 104 тендера. До сужения — 1 289 позиций в 52 тендерах; из них 1 203 расценены и
перешли в правило U. После сужения остаётся **86** позиций.
