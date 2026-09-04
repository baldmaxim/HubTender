---
code: Y
title: Количество ГП расходится с количеством заказчика более чем в 10 раз
severity: warning
money: no
status: draft
---
## Суть

Оба объёма заданы, единица одна и та же (она у позиции одна), а значения
расходятся больше чем на порядок.

Законные расхождения бывают: ГП пересчитал объём по чертежам и получил заметно
другое число. Но десятикратный разрыв — это почти всегда опечатка на порядок при
вводе, и она уезжает прямо в цену за единицу и во все удельные показатели, по
которым потом сравнивают объекты.

Порог намеренно грубый. Мягче — правило утонет в нормальных уточнениях объёма.

## SQL

```sql
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', trim_scale(cp.manual_volume), trim_scale(cp.volume),
                COALESCE(cp.unit_code, ''))) AS fingerprint,
  concat_ws(' ',
    'Кол-во ГП', round(cp.manual_volume, 4)::text,
    'против количества заказчика', round(cp.volume, 4)::text,
    COALESCE(cp.unit_code, ''), '— расхождение',
    round(GREATEST(cp.manual_volume / cp.volume,
                   cp.volume / cp.manual_volume), 1)::text || '×') AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
WHERE cp.tender_id = $1
  AND COALESCE(cp.volume, 0) > 0
  AND COALESCE(cp.manual_volume, 0) > 0
  AND GREATEST(cp.manual_volume / cp.volume,
               cp.volume / cp.manual_volume) > 10
ORDER BY cp.position_number
```

## Подтверждено

- TP: не снято — правило в статусе `draft`.
- FP: ожидаются позиции, где единица ведомости и единица работы разные по смыслу
  (комплект против штук), — там разрыв на порядок нормален.

## Замер

Не снят. При замере имеет смысл сразу посмотреть распределение отношения
объёмов: если разрывов ровно в 10, 100 и 1000 раз заметно больше, чем плавных,
это подтверждает гипотезу об опечатке и позволяет ужать правило до кратных
порядков.
