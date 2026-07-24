---
code: M
title: Коэффициент перевода вне разумного диапазона
severity: warning
money: no
status: active
---
## Суть

Коэффициент перевода меньше 0.0001 или больше 1000. Такие значения почти всегда
означают ошибку ввода — потерянный или лишний порядок, запятая не на месте.

Коэффициент участвует в выводе количества привязанного материала
(`работа × перевод × расход`), поэтому ошибка в порядке величины сразу уводит
количество материала в тысячи раз.

Границы подобраны по факту: в базе есть законные коэффициенты порядка 0.0013
(например, метизы на тонну металлоконструкций), поэтому нижняя граница взята
с запасом на порядок ниже.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.conversion_coefficient, b.quantity, b.unit_rate)) AS fingerprint,
  concat_ws(' ',
    'Коэффициент перевода', b.conversion_coefficient::text,
    '; количество ГП', round(COALESCE(b.quantity, 0), 4)::text) AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.conversion_coefficient IS NOT NULL
  AND (b.conversion_coefficient < 0.0001 OR b.conversion_coefficient > 1000)
ORDER BY cp.position_number
```

## Подтверждено

- TP: 149 строк в 24 тендерах.
- FP: возможен для материалов с законно малым расходом на единицу работы. Граница
  0.0001 выбрана так, чтобы реальные значения вроде 0.0013 в неё не попадали.

## Замер (2026-07-24)

149 строк в 24 тендерах.
