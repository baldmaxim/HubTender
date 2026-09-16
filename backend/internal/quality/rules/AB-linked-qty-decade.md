---
code: AB
title: Количество привязанного материала отличается от формулы ровно на порядок
severity: error
money: yes
status: active
entity_type: boq_item
---
## Суть

Материал привязан к работе, а его количество ГП отличается от
`работа × перевод × расход` **ровно на порядок** (10×, 100× или 1000×, допуск 3%).

Это уже не «считали от объёма позиции» и не мелкий дрейф коэффициентов — почти всегда
ошибка единицы (дм³↔м³, г↔кг) или сдвиг запятой. Денежный эффект большой: на
«Большой Татарской» около 12 таких строк дали ~25.5 млн ₽ из ~35.9 млн по всему A.

Правило **A** эти строки не выдаёт: одна строка — одна находка. ГП = 1 (оборудование
комплектом) не считается ошибкой единиц.

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
  -- Отпечаток совпадает с правилом A: вердикт, поставленный по A, переносится
  -- на AB без потери (см. 2026_09_quality_rules_tatar_verdicts.sql).
  md5(concat_ws('|', trim_scale(s.quantity), trim_scale(s.work_qty),
                trim_scale(s.conversion_coefficient),
                trim_scale(s.consumption_coefficient),
                trim_scale(s.unit_rate))) AS fingerprint,
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
  -- ГП = 1 — оборудование комплектом («ЖК Cityzen», поз. 2062: 1 против 101),
  -- а не ошибка единиц.
  AND s.quantity <> 1
  -- Допуск 1%: у настоящих находок кратность ровно 10.0×; при 3% в правило
  -- попадало 101× как «100×».
  AND (
       abs(s.ratio - 10)   / 10   < 0.01
    OR abs(s.ratio - 100)  / 100  < 0.01
    OR abs(s.ratio - 1000) / 1000 < 0.01
  )
ORDER BY abs(COALESCE(s.quantity, 0) - s.formula) * COALESCE(s.unit_rate, 0) DESC
```

## Подтверждено

- TP: «Большая Татарская» v2, поз. 811 (08.01.03) — ГП 152 767.692 против формулы
  15 276.7692, ровно 10×; та же картина на 810, 812, 813. 12 строк, 25.5 млн ₽.
- TP: «Шаболовка 34» v1–v3, поз. 3.3.1.5.9 — 7 584.28 против 758.428 (10×) и ещё две
  строки той же позиции, 44 млн ₽ в каждой версии.
- FP (исключён): «ЖК Cityzen», поз. 2062 — ГП = 1 при формуле 101 (оборудование
  комплектом, как в правиле A). При допуске 3% попадал в «100×» с эффектом −1.1 млрд ₽.

## Замер (2026-09-16)

База 105 тендеров: **30 находок в 5 тендерах, 182.4 млн ₽**. На «Большой Татарской» v2 — 12.
До сужения (допуск 3%, без исключения ГП = 1) — 32 находки и −2 млрд ₽ из-за Cityzen.
Правило A после исключения этих строк — 1 851 находка в 75 тендерах (было 1 881).
