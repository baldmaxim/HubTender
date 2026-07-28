---
code: Q
title: Нулевая цена за единицу
severity: warning
money: no
status: active
---
## Суть

У строки цена за единицу равна нулю или не заполнена. Итог такой строки всегда ноль,
сколько бы ни было количества — она есть в ведомости, но в деньги не попадает.

Бывает законно: давальческий материал, работа внутри комплекса, строка-заголовок.
Поэтому severity `warning`, а не ошибка. Но чаще это просто незаполненная расценка,
и тогда тендер занижен на неизвестную величину.

Работы дают такие строки заметно чаще материалов (4 589 против 879) — при разборе
имеет смысл начинать с них.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', COALESCE(b.unit_rate, 0), COALESCE(b.quantity, 0), b.boq_item_type::text)) AS fingerprint,
  concat_ws(' ',
    CASE WHEN b.boq_item_type::text LIKE '%раб%' THEN 'Работа' ELSE 'Материал' END,
    'без цены; количество', round(COALESCE(b.quantity, 0), 4)::text,
    'ед., итог', round(COALESCE(b.total_amount, 0), 2)::text, '₽') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND COALESCE(b.unit_rate, 0) = 0
ORDER BY cp.position_number
```

## Подтверждено

- TP: 5 468 строк в 73 тендерах.
- FP: «Река 4 v7», позиция 08.02.06, работа «примыкание кладки» — цена 0 при количестве 1.
  Работа существует как носитель привязанных материалов, собственной расценки не имеет.
  Таких случаев по базе всего 2 (работа с ценой 0 и количеством 1), так что паттерн редкий.

## Замер (2026-07-24)

5 468 строк в 73 тендерах: 4 589 работ и 879 материалов.
