---
code: QA
title: Нулевая цена у строки без роли носителя
severity: warning
money: no
status: draft
entity_type: boq_item
---
## Суть

Цена за единицу = 0, и строка **не выглядит носителем** привязанных материалов.

Правило **Q** на «Большой Татарской» дало 430 находок — все работы без цены. Часть из
них законна: работа с qty≈1 держит дочерние материалы и сама в деньги не входит.
Остальное — незаполненная расценка.

QA отбрасывает работы, у которых есть хотя бы один дочерний материал и количество
работы около 1 (0.99–1.01). Материалы с нулевой ценой и работы без детей / с qty≠1
остаются — их и нужно разбирать первыми.

После замера: либо Q → `draft`, либо Q оставить только для материалов, а работы
вести через QA.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', trim_scale(COALESCE(b.unit_rate, 0)),
                trim_scale(COALESCE(b.quantity, 0)), b.boq_item_type::text)) AS fingerprint,
  concat_ws(' ',
    CASE WHEN b.boq_item_type::text LIKE '%раб%' THEN 'Работа' ELSE 'Материал' END,
    'без цены; количество', round(COALESCE(b.quantity, 0), 4)::text,
    'ед., итог', round(COALESCE(b.total_amount, 0), 2)::text, '₽') AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND COALESCE(b.unit_rate, 0) = 0
  AND NOT (
    b.boq_item_type::text LIKE '%раб%'
    AND COALESCE(b.quantity, 0) BETWEEN 0.99 AND 1.01
    AND EXISTS (
      SELECT 1 FROM public.boq_items c
      WHERE c.parent_work_item_id = b.id
        AND c.boq_item_type::text LIKE '%мат%'
    )
  )
ORDER BY cp.position_number
```

## Подтверждено

- FP-класс (должен исчезнуть из списка): работа-носитель с qty=1 и привязанными
  материалами — паттерн из Q («Река 4», примыкание кладки) и массовый хвост на
  «Большой Татарской».
- TP: работы с нулевой ценой и количеством ≫ 1 без детей; материалы unit_rate=0.
  Конкретные item_no — дописать после замера.

## Замер

Черновик. На «Большой Татарской» Q=430 (все работы). Ожидание QA: заметно меньше 430;
если почти не упало — носители здесь с qty≠1, тогда уточнить условие (например,
исключать любую работу с детьми независимо от qty).
