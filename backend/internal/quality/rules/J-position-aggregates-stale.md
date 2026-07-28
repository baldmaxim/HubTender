---
code: J
title: Агрегаты позиции не совпадают с суммой её строк
severity: error
money: yes
status: active
---
## Суть

У позиции заказчика хранятся итоги `total_material` и `total_works` — суммы по её
материалам и работам. Они разошлись с фактической суммой строк: агрегат посчитали
однажды, потом строки поменяли, а пересчёт позиции не отработал.

Страница «Позиции заказчика» считает итог на лету и покажет верное число, поэтому
расхождение обычно незаметно. Но экспорт в Excel берёт эти агрегаты для строк-разделов,
и там устаревшее значение выходит наружу.

Самый частый вид — агрегат равен нулю при живых строках: позицию наполнили, а итог
так и остался нулевым.

## SQL

```sql
WITH s AS (
  SELECT
    b.client_position_id,
    COALESCE(SUM(b.total_amount) FILTER (WHERE b.boq_item_type::text LIKE '%мат%'), 0) AS tm,
    COALESCE(SUM(b.total_amount) FILTER (WHERE b.boq_item_type::text LIKE '%раб%'), 0) AS tw,
    COUNT(*) AS n
  FROM public.boq_items b
  WHERE b.tender_id = $1
  GROUP BY b.client_position_id
)
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', cp.total_material, cp.total_works, s.tm, s.tw, s.n)) AS fingerprint,
  concat_ws(' ',
    'Агрегат позиции', round(COALESCE(cp.total_material,0) + COALESCE(cp.total_works,0), 2)::text,
    '₽, сумма строк', round(s.tm + s.tw, 2)::text,
    '₽ (строк:', s.n::text || ')') AS detail,
  round((s.tm + s.tw) - (COALESCE(cp.total_material,0) + COALESCE(cp.total_works,0)), 2) AS money_delta
FROM public.client_positions cp
JOIN s ON s.client_position_id = cp.id
WHERE cp.tender_id = $1
  AND (
    abs(COALESCE(cp.total_material, 0) - s.tm) >= 1
    OR abs(COALESCE(cp.total_works, 0) - s.tw) >= 1
  )
ORDER BY abs((s.tm + s.tw) - (COALESCE(cp.total_material,0) + COALESCE(cp.total_works,0))) DESC
```

## Подтверждено

- TP: «Река 4 v4», позиция 280 «Монтаж алюминиевых оконных…» — 10 строк на
  2 089 854 912 ₽, при этом `total_material` = 0 и `total_works` = 0.
- TP: та же картина в «Миг Корпус 1-9» (поз. 133, 758 778 025 ₽), «ЖК Сокольники»
  (поз. 491, 339 строк на 742 408 345 ₽), «Садовническая 69» (поз. 73, 708 168 702 ₽).
- FP: не зафиксировано. Позиция со строками обязана иметь агрегат, равный их сумме.

## Замер (2026-07-24)

**16 605 позиций в 80 тендерах** (допуск ≥ 1 ₽). Без допуска правило даёт 16 689 —
лишние 84 позиции расходятся на копейки, это арифметика с плавающей точкой.

Подавляющая часть — агрегат равен нулю при непустом наборе строк. Крупнейшие:
«Река 4 v7» позиция 13.01.15 — агрегат 0 ₽ при двух строках на 47 139 118 ₽;
позиция 01.01.10 — агрегат 0 ₽ при 23 строках на 19 813 392 ₽.
