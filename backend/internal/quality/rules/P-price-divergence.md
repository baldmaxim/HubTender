---
code: P
title: Один материал закуплен в тендере по сильно разным ценам
severity: warning
money: no
status: active
---
## Суть

Один и тот же материал из справочника встречается в тендере по ценам, различающимся
более чем вдвое. В пределах одного тендера это подозрительно: либо часть строк
осталась со старой расценкой, либо где-то ошиблись порядком.

Законные причины тоже есть: разные поставки, разные условия доставки, материал
одного наименования, но разной комплектации. Поэтому severity `warning`.

Правило смотрит только строки с ненулевой ценой — нулевые разбирает правило **Q**.

## SQL

```sql
SELECT
  b.tender_id,
  MIN(cp.position_number) AS position_number,
  MIN(cp.item_no) AS item_no,
  b.material_name_id AS entity_id,
  md5(concat_ws('|', b.material_name_id::text, MIN(b.unit_rate), MAX(b.unit_rate), COUNT(*))) AS fingerprint,
  concat_ws(' ',
    'Материал', COALESCE(MIN(mn.name), '(без справочника)'),
    ': цены от', round(MIN(b.unit_rate), 2)::text,
    'до', round(MAX(b.unit_rate), 2)::text,
    '₽ (разброс', round(MAX(b.unit_rate) / NULLIF(MIN(b.unit_rate), 0), 1)::text || '×,',
    COUNT(*)::text, 'строк)') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
WHERE b.tender_id = $1
  AND b.material_name_id IS NOT NULL
  AND COALESCE(b.unit_rate, 0) > 0
GROUP BY b.tender_id, b.material_name_id
HAVING MAX(b.unit_rate) > 2 * MIN(b.unit_rate)
ORDER BY MAX(b.unit_rate) / NULLIF(MIN(b.unit_rate), 0) DESC
```

## Подтверждено

- TP: 757 материалов в 78 тендерах.
- TP: «Событие 6.1» — установка COR-3 MVL 419 подорожала с 1 223 143.92 до
  1 423 143.92 ₽ между версиями; разброс менее 2×, поэтому правило её не показывает —
  порог отсекает нормальную коррекцию цены.
- FP: разные поставки и комплектации одного наименования.

## Замер (2026-07-24)

757 материалов в 78 тендерах.
