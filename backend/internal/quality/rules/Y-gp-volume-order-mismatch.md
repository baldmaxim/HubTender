---
code: Y
title: Количество ГП расходится с количеством заказчика более чем в 10 раз
severity: warning
money: no
status: active
entity_type: client_position
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
  -- Объём 1 у заказчика или у ГП — «комплект»/«лот», а не опечатка на порядок.
  AND cp.volume <> 1
  AND cp.manual_volume <> 1
  AND GREATEST(cp.manual_volume / cp.volume,
               cp.volume / cp.manual_volume) > 10
  -- Ровно 10×, 100×, 1000× (±2%) забирает правило YD (error).
  AND NOT (
       abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 10)
         / 10 < 0.02
    OR abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 100)
         / 100 < 0.02
    OR abs(GREATEST(cp.manual_volume / cp.volume, cp.volume / cp.manual_volume) - 1000)
         / 1000 < 0.02
  )
ORDER BY cp.position_number
```

## Подтверждено

- TP: фундаментная плита — у заказчика 301 м³, Кол-во ГП 3 024,86 м³; монолитные
  колонны 300×600 — 38,13 м³ против 1 392,29 м³.
- TP: «Большая Татарская» — 9 находок, все с вердиктом инженера `error` (в т.ч. поз. 34
  ~10× м³; поз. 226/227 ровно 1000×). Точные декады выносятся в черновик **YD**
  (`error`); Y остаётся для «грязных» >10× (11.1× и т.п.).
- FP: позиция, где заказчик дал объём «1» (комплект, лот), а ГП посчитал реальный
  объём — именно поэтому такие позиции исключены.

## Замер (2026-09-15)

База 104 тендера.

- Без исключения «объём = 1» — **3 644 находки в 50 тендерах**, из них 2 477 с
  разрывом больше 100× и только 38 ровно в 10/100/1000 раз: подавляющая часть — объём
  заказчика «1 комплект» при посчитанном объёме ГП.
- С исключением — **251 находка в 37 тендерах**, выборка похожа на реальные
  расхождения.

Срез (2026-09-16): «Большая Татарская» — 9 (7≈10×, 2×1000×).
