---
code: P
title: Цены одного материала различаются более чем вдвое
severity: warning
money: no
status: active
entity_type: material_name
---
## Суть

Один и тот же материал из справочника встречается в тендере по ценам, различающимся
более чем вдвое. В пределах одного тендера это подозрительно: либо часть строк
осталась со старой расценкой, либо где-то ошиблись порядком.

Законные причины тоже есть: разные поставки, разные условия доставки, материал
одного наименования, но разной комплектации. Поэтому severity `warning`.

Правило смотрит только строки с ненулевой ценой — нулевые разбирает правило **Q**. Номер позиции ведёт на строку, чья цена дальше всех от типичной (медианной) цены этого материала в тендере.

## SQL

```sql
WITH priced AS (
  SELECT
    b.id,
    b.tender_id,
    b.material_name_id,
    b.unit_rate,
    cp.position_number,
    cp.item_no
  FROM public.boq_items b
  JOIN public.client_positions cp ON cp.id = b.client_position_id
  WHERE b.tender_id = $1
    AND b.material_name_id IS NOT NULL
    AND COALESCE(b.unit_rate, 0) > 0
),
spread AS (
  SELECT
    p.tender_id,
    p.material_name_id,
    MIN(p.unit_rate) AS min_rate,
    MAX(p.unit_rate) AS max_rate,
    COUNT(*) AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY p.unit_rate) AS median_rate
  FROM priced p
  GROUP BY p.tender_id, p.material_name_id
  HAVING MAX(p.unit_rate) > 2 * MIN(p.unit_rate)
),
-- Строка для ссылки «к строке»: цена дальше всех (в разах) от медианы материала
-- в тендере — выброс, а не просто самая дорогая строка. При равенстве — меньший
-- № позиции.
target AS (
  SELECT DISTINCT ON (p.material_name_id)
    p.material_name_id, p.id, p.position_number, p.item_no
  FROM priced p
  JOIN spread s ON s.material_name_id = p.material_name_id
  ORDER BY p.material_name_id,
           abs(ln(p.unit_rate::float8 / s.median_rate)) DESC,
           p.position_number, p.id
)
SELECT
  s.tender_id,
  t.position_number,
  t.item_no,
  s.material_name_id AS entity_id,
  md5(concat_ws('|', s.material_name_id::text, trim_scale(s.min_rate),
                trim_scale(s.max_rate), s.n)) AS fingerprint,
  concat_ws(' ',
    'Материал', COALESCE(mn.name, '(без справочника)'),
    ': цены от', round(s.min_rate, 2)::text,
    'до', round(s.max_rate, 2)::text,
    '₽ (разброс', round(s.max_rate / NULLIF(s.min_rate, 0), 1)::text || '×,',
    s.n::text, 'строк)') AS detail,
  NULL::numeric AS money_delta,
  t.id AS item_id
FROM spread s
JOIN target t ON t.material_name_id = s.material_name_id
LEFT JOIN public.material_names mn ON mn.id = s.material_name_id
ORDER BY s.max_rate / NULLIF(s.min_rate, 0) DESC
```

## Подтверждено

- TP: 757 материалов в 78 тендерах.
- TP: «Событие 6.1» — установка COR-3 MVL 419 подорожала с 1 223 143.92 до
  1 423 143.92 ₽ между версиями; разброс менее 2×, поэтому правило её не показывает —
  порог отсекает нормальную коррекцию цены.
- FP: разные поставки и комплектации одного наименования.

## Замер (2026-07-24)

757 материалов в 78 тендерах.
