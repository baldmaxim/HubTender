---
code: Z
title: Количество ГП задано, а единица измерения позиции пуста
severity: warning
money: no
status: draft
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

## Замер

Не снят. Ожидается мало находок; если их ноль, правило переводится в разряд
стражей регресса рядом с **E** и **F**.
