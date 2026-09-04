---
code: V
title: Конечная позиция не расценена и без обоснования
severity: error
money: no
status: draft
---
## Суть

У конечной позиции есть объём заказчика, но нет ни одной строки расчёта, и при
этом «Примечание ГП» пустое.

Пустая строка в форме КП сама по себе не ошибка: часть объёмов законно не наша.
Но тогда в примечании обязано стоять объяснение, почему не расценено — иначе
заказчик получает пустую строку без ответа, а руководство не отличает «не наш
объём» от «забыли посчитать».

Сегодня такие строки видны только по бледно-красной заливке в Excel формы КП
(`isZeroCost`) — их никто не считает и не отслеживает.

Заголовки разделов исключены: они не расцениваются по определению. Конечная
позиция определяется так же, как на сервере в списке позиций — по тому, что у
следующей позиции уровень иерархии не выше.

## SQL

```sql
WITH leaves AS (
  SELECT cp.id, cp.tender_id, cp.position_number, cp.item_no, cp.work_name,
         cp.manual_note, cp.volume, cp.unit_code,
         COALESCE(nxt.next_level > COALESCE(cp.hierarchy_level, 0), false) AS is_section
  FROM public.client_positions cp
  LEFT JOIN LATERAL (
    SELECT COALESCE(n.hierarchy_level, 0) AS next_level
    FROM public.client_positions n
    WHERE n.tender_id = cp.tender_id
      AND COALESCE(n.is_additional, false) = false
      AND (n.position_number, n.id) > (cp.position_number, cp.id)
    ORDER BY n.position_number, n.id
    LIMIT 1
  ) nxt ON true
  WHERE cp.tender_id = $1
)
SELECT
  l.tender_id,
  l.position_number,
  l.item_no,
  l.id AS entity_id,
  md5(concat_ws('|', trim_scale(COALESCE(agg.total, 0)), agg.rows_count::text,
                COALESCE(md5(btrim(l.manual_note)), 'none'),
                trim_scale(COALESCE(l.volume, 0)))) AS fingerprint,
  concat_ws(' ',
    'Позиция не расценена (строк:', agg.rows_count::text,
    ', сумма 0 ₽); объём заказчика', round(COALESCE(l.volume, 0), 4)::text,
    COALESCE(l.unit_code, ''), '; «Примечание ГП» пустое') AS detail,
  NULL::numeric AS money_delta
FROM leaves l
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS rows_count, COALESCE(SUM(b.total_amount), 0) AS total
  FROM public.boq_items b
  WHERE b.client_position_id = l.id
) agg ON true
WHERE l.is_section = false
  AND COALESCE(agg.total, 0) = 0
  AND COALESCE(btrim(l.manual_note), '') = ''
  AND COALESCE(l.volume, 0) > 0
ORDER BY l.position_number
```

Отпечаток — сумма позиции, число строк и хеш примечания. Инженер написал
обоснование — отпечаток разошёлся, находка закрылась сама, без вердикта.

## Подтверждено

- TP: не снято — правило в статусе `draft`.
- FP: ожидаются позиции, где объём заказчика проставлен у строки-заголовка
  (тогда предикат «конечной позиции» придётся ужать по `hierarchy_level`).

## Замер

Не снят. Перед переводом в `active` обязателен прогон на проде: если находок
больше пары тысяч, предикат конечной позиции слишком широк.
