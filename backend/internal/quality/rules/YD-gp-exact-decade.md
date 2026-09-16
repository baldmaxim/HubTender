---
code: YD
title: Количество ГП отличается от заказчика ровно на порядок
severity: error
money: no
status: active
entity_type: client_position
---
## Суть

Оба объёма заданы, и отношение ГП / заказчик (или наоборот) — **ровно 10×, 100× или
1000×** (допуск 2%).

Правило **Y** ловит любое расхождение > 10× и остаётся warning: часть случаев —
законный пересчёт по чертежам. Точная декада почти всегда опечатка единицы или
запятой. На «Большой Татарской» все 9 находок Y инженер пометил `error`; 7≈10×,
2 ровно 1000× (поз. 226, 227).

Правило **Y** эти позиции не выдаёт. Отпечаток совпадает с Y, поэтому вердикты,
поставленные по Y, переносятся на YD (`2026_09_quality_rules_tatar_verdicts.sql`).

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
  -- Допуск 2%: пропускает округление мелких объёмов (1.14 → 11.46 м³ = 10.05×),
  -- но отсекает 9.6× и 10.4× — это уже не опечатка запятой.
  AND (
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

- TP: «Большая Татарская» v2 — поз. 34 (3 024.86 против 301.01 м³), 36, 45, 47, 49, 56,
  65, 71, 96, 97, 101, 108, 109 (≈10×), поз. 226 и 227 (ровно 1000×). По Y инженер
  отметил их `error`.
- TP-кандидаты: «Река 4» v8, поз. 353 и 365 — ГП в 10 раз меньше заказчика (183.25
  против 1 832.5); «ЖК Ultima City» v2, поз. 405 — 405 против 4.05 м³ (100×).
- FP (исключены): объём «1» у заказчика или ГП (комплект, как у Y); «Шаболовка 34»,
  поз. 222 — 975 против 9 350 м² (9.6×) и «ЖК Остров 14», поз. 229 — 10.4×: при
  допуске 5% попадали, это уже не опечатка запятой.

## Замер (2026-09-16)

База 105 тендеров: **26 находок в 8 тендерах**. На «Большой Татарской» v2 — 15 (было 9
в Y: YD забирает и ровные декады чуть меньше 10×, например 3 953.55 против 395.83).
Правило Y после исключения декад — 244 находки в 38 тендерах (было 257); на Татарской в
Y остаются поз. 41 (11.1×) и 51 (11.2×).
