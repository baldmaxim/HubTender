---
code: AB
title: Количество привязанного материала отличается от формулы ровно на порядок
severity: error
money: yes
status: draft
entity_type: boq_item
---
## Суть

Материал привязан к работе, а его количество ГП отличается от
`работа × перевод × расход` **ровно на порядок** (10×, 100× или 1000×, допуск 3%).

Это уже не «считали от объёма позиции» и не мелкий дрейф коэффициентов — почти всегда
ошибка единицы (дм³↔м³, г↔кг) или сдвиг запятой. Денежный эффект большой: на
«Большой Татарской» около 12 таких строк дали ~25.5 млн ₽ из ~35.9 млн по всему A.

После выката в `active` правило **A** должно исключать те же строки (иначе дубль).

## SQL

```sql
WITH base AS (
  SELECT
    b.id,
    b.tender_id,
    b.client_position_id,
    b.quantity,
    b.unit_rate,
    b.currency_type,
    b.conversion_coefficient,
    b.consumption_coefficient,
    w.quantity AS work_qty,
    COALESCE(w.quantity, 0)
      * COALESCE(NULLIF(b.conversion_coefficient, 0), 1)
      * COALESCE(NULLIF(b.consumption_coefficient, 0), 1) AS formula,
    t.usd_rate, t.eur_rate, t.cny_rate
  FROM public.boq_items b
  JOIN public.boq_items w ON w.id = b.parent_work_item_id
  JOIN public.tenders t ON t.id = b.tender_id
  WHERE b.tender_id = $1
    AND b.boq_item_type::text LIKE '%мат%'
),
scored AS (
  SELECT
    *,
    CASE
      WHEN formula > 0.01 AND quantity > 0.01 THEN
        GREATEST(quantity / formula, formula / quantity)
      ELSE NULL
    END AS ratio
  FROM base
)
SELECT
  s.tender_id,
  cp.position_number,
  cp.item_no,
  s.id AS entity_id,
  md5(concat_ws('|', trim_scale(s.quantity), trim_scale(s.work_qty),
                trim_scale(s.conversion_coefficient),
                trim_scale(s.consumption_coefficient),
                trim_scale(s.unit_rate),
                round(s.ratio)::text)) AS fingerprint,
  concat_ws(' ',
    'Количество ГП', round(COALESCE(s.quantity, 0), 4)::text,
    '; формула даёт', round(s.formula, 4)::text,
    '— кратность', round(s.ratio, 1)::text || '× (порядок единиц)') AS detail,
  round(
    (COALESCE(s.quantity, 0) - s.formula)
    * COALESCE(s.unit_rate, 0)
    * CASE s.currency_type::text
        WHEN 'USD' THEN COALESCE(s.usd_rate, 1)
        WHEN 'EUR' THEN COALESCE(s.eur_rate, 1)
        WHEN 'CNY' THEN COALESCE(s.cny_rate, 1)
        ELSE 1 END
  , 2) AS money_delta
FROM scored s
JOIN public.client_positions cp ON cp.id = s.client_position_id
WHERE s.ratio IS NOT NULL
  AND (
       abs(s.ratio - 10)   / 10   < 0.03
    OR abs(s.ratio - 100)  / 100  < 0.03
    OR abs(s.ratio - 1000) / 1000 < 0.03
  )
ORDER BY abs(COALESCE(s.quantity, 0) - s.formula) * COALESCE(s.unit_rate, 0) DESC
```

## Подтверждено

- TP: «Большая Татарская», поз. 811 — ГП 152 767.692 против формулы 15 276.7692 (ровно
  10×); та же картина на 812 и соседних материалах. Суммарно по тендеру ≈ 12 строк /
  ~25.5 млн ₽ внутри A.
- FP: пока не найдены. Если появится законный расход ровно 10× нормы — завести
  исключение по типу материала, не расширять допуск.

## Замер

Черновик. Прогнать на базе и на `42c984c7-c027-4bed-88ed-f1f9bd1444ec` до `active`.
Ожидание на этом тендере: ≈ 12 находок (срез A с кратностью 10×).
