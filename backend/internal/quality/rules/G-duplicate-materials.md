---
code: G
title: Один и тот же материал заведён в позиции несколько раз
severity: warning
money: yes
status: active
---
## Суть

В одной позиции один и тот же материал (то же наименование из справочника) заведён
несколькими строками с одинаковой ценой за единицу. Похоже на задвоение при импорте
или копировании.

Не всегда ошибка: материал законно дублируется, если строки относятся к разным
категориям затрат или к разным работам. Поэтому severity `warning`, а денежный
эффект — **оценка сверху**: сумма всех дублирующих строк, кроме одной, то есть
«сколько уйдёт, если это действительно задвоение».

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  (array_agg(b.id ORDER BY b.id))[1] AS entity_id,
  md5(concat_ws('|', b.material_name_id::text, b.unit_rate, COUNT(*))) AS fingerprint,
  concat_ws(' ',
    'Материал', COALESCE(MIN(mn.name), '(без справочника)'),
    'заведён', COUNT(*)::text, 'раз с ценой',
    round(COALESCE(b.unit_rate, 0), 2)::text, '₽; суммарно',
    round(SUM(COALESCE(b.total_amount, 0)), 2)::text, '₽') AS detail,
  round(SUM(COALESCE(b.total_amount, 0)) - MAX(COALESCE(b.total_amount, 0)), 2) AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
WHERE b.tender_id = $1
  AND b.material_name_id IS NOT NULL
GROUP BY b.tender_id, cp.position_number, cp.item_no, b.client_position_id,
         b.material_name_id, b.unit_rate
HAVING COUNT(*) > 1
ORDER BY SUM(COALESCE(b.total_amount, 0)) - MAX(COALESCE(b.total_amount, 0)) DESC
```

## Подтверждено

- TP: 9 192 группы в 80 тендерах.
- FP: ожидается заметная доля — материал легитимно повторяется, когда строки отнесены
  к разным категориям затрат или привязаны к разным работам. Правило намеренно не
  различает эти случаи: решает инженер.

## Замер (2026-07-24)

9 192 группы дублей в 80 тендерах.
