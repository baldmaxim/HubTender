---
code: Z
title: Количество ГП задано, а единица измерения позиции пуста
severity: warning
money: no
status: draft
entity_type: client_position
---
## Суть

Объём генподряда проставлен, а единицы измерения у позиции нет.

Такая позиция ломает всё, что считается «за единицу»: цену за единицу в форме КП,
удельные показатели в затратах на строительство и сравнение объектов. Число есть,
а что оно означает — неизвестно, и в сравнении двух объектов эта позиция молча
портит показатель, не давая никакого сигнала.

Правило дешёвое и прямо защищает шаг сравнения с ранее посчитанным объектом.

## SQL

```sql
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', trim_scale(COALESCE(cp.manual_volume, 0)),
                COALESCE(cp.unit_code, ''),
                trim_scale(COALESCE(cp.volume, 0)))) AS fingerprint,
  concat_ws(' ',
    'Кол-во ГП', round(cp.manual_volume, 4)::text,
    'задано без единицы измерения') AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
WHERE cp.tender_id = $1
  AND COALESCE(cp.manual_volume, 0) > 0
  AND COALESCE(btrim(cp.unit_code), '') = ''
ORDER BY cp.position_number
```

## Подтверждено

- TP: не снято — правило в статусе `draft`.
- FP: не ожидаются — единица у расценённой позиции обязана быть.

## Замер (2026-09-15)

База 104 тендера: **5 228 находок в 48 тендерах**, из них 4 567 уже расценены. Пустая
единица приходит из файла ВОР заказчика при загрузке, а не от ошибки инженера — на
таком объёме это вопрос качества импорта. Оставлено черновиком.
