---
code: YD
title: Количество ГП отличается от заказчика ровно на порядок
severity: error
money: no
status: draft
entity_type: client_position
---
## Суть

Оба объёма заданы, и отношение ГП / заказчик (или наоборот) — **ровно 10×, 100× или
1000×** (допуск 5%).

Правило **Y** ловит любое расхождение > 10× и остаётся warning: часть случаев —
законный пересчёт по чертежам. Точная декада почти всегда опечатка единицы или
запятой. На «Большой Татарской» все 9 находок Y инженер пометил `error`; 7≈10×,
2 ровно 1000× (поз. 226, 227).

После выката: из SQL **Y** исключить те же декады, чтобы не дублировать.

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
    COALESCE(cp.unit_code, ''), '— ровно',
    round(GREATEST(cp.manual_volume / cp.volume,
                   cp.volume / cp.manual_volume), 1)::text || '× (порядок)') AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
WHERE cp.tender_id = $1
  AND COALESCE(cp.volume, 0) > 0
  AND COALESCE(cp.manual_volume, 0) > 0
  AND cp.volume <> 1
  AND cp.manual_volume <> 1
  AND (
       abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 10)
         / 10 < 0.05
    OR abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 100)
         / 100 < 0.05
    OR abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 1000)
         / 1000 < 0.05
  )
ORDER BY cp.position_number
```

## Подтверждено

- TP: «Большая Татарская» — поз. 34 (3024.86 vs 301.01 м³, 10×), 45/56/… (~10×),
  поз. 226 и 227 (ровно 1000×). Вердикты инженера: `error`.
- FP: объём заказчика = 1 (комплект) исключён теми же условиями, что у Y.

## Замер

Черновик. Ожидание на «Большой Татарской»: 9 (весь текущий Y) или чуть меньше, если
11.1×/11.2× не проходят допуск 5% к 10 — тогда допуск 12% или оставить их в Y.
