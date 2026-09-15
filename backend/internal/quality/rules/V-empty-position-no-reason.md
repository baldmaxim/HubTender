---
code: V
title: Позиция не расценена и без обоснования в расценённом разделе
severity: warning
money: no
status: active
entity_type: client_position
---
## Суть

У конечной позиции есть объём заказчика, строк расчёта с деньгами нет, «Примечание ГП»
пустое — а раздел, в котором она стоит, расценён хотя бы наполовину.

Пустая строка в форме КП сама по себе не ошибка: часть объёмов законно не наша. Но
тогда в примечании обязано стоять объяснение, почему не расценено — иначе заказчик
получает пустую строку без ответа, а руководство не отличает «не наш объём» от
«забыли посчитать».

Правило смотрит только на разделы, где работа уже идёт (расценено не меньше половины
конечных позиций). Разделы, где не расценено ничего или почти ничего, — это не
пропущенная строка, а нерасценённый раздел: он виден в панели «Готовность по разделам
ВОР» как «не начато» и одной находкой на каждую строку только утопил бы список.

Раздел — заголовок верхнего уровня иерархии, так же как в панели разделов; заголовки
и дополнительные позиции не проверяются.

## SQL

```sql
WITH base AS (
  SELECT cp.id, cp.tender_id, cp.position_number, cp.item_no, cp.manual_note,
         cp.volume, COALESCE(cp.hierarchy_level, 0) AS lvl
  FROM public.client_positions cp
  WHERE cp.tender_id = $1
    AND COALESCE(cp.is_additional, false) = false
),
marked AS (
  SELECT b.*,
         COALESCE(LEAD(b.lvl) OVER (ORDER BY b.position_number, b.id) > b.lvl, false) AS is_header
  FROM base b
),
top AS (
  SELECT min(lvl) AS top_lvl FROM marked WHERE is_header
),
grouped AS (
  SELECT m.*,
         count(*) FILTER (WHERE m.is_header AND m.lvl = t.top_lvl)
           OVER (ORDER BY m.position_number, m.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
  FROM marked m
  CROSS JOIN top t
),
leaves AS (
  SELECT g.*, COALESCE(r.total, 0) AS total, COALESCE(r.n, 0) AS rows_count
  FROM grouped g
  LEFT JOIN (
    SELECT client_position_id, count(*) AS n, sum(total_amount) AS total
    FROM public.boq_items
    WHERE tender_id = $1
    GROUP BY client_position_id
  ) r ON r.client_position_id = g.id
  WHERE NOT g.is_header
),
sec AS (
  SELECT grp, count(*) AS n, count(*) FILTER (WHERE total > 0) AS priced
  FROM leaves
  GROUP BY grp
)
SELECT
  l.tender_id,
  l.position_number,
  l.item_no,
  l.id AS entity_id,
  md5(concat_ws('|', trim_scale(l.total), l.rows_count::text,
                COALESCE(md5(btrim(l.manual_note)), 'none'),
                trim_scale(COALESCE(l.volume, 0)))) AS fingerprint,
  concat_ws(' ',
    'Не расценена, «Примечание ГП» пустое; в разделе расценено', s.priced::text,
    'из', s.n::text, 'позиций') AS detail,
  NULL::numeric AS money_delta
FROM leaves l
JOIN sec s ON s.grp = l.grp
WHERE l.total <= 0
  AND COALESCE(l.volume, 0) > 0
  AND COALESCE(btrim(l.manual_note), '') = ''
  AND s.priced * 2 >= s.n
ORDER BY l.position_number
```

Отпечаток — сумма позиции, число строк, хеш примечания и объём. Инженер написал
обоснование или расценил позицию — находка закрывается сама, без вердикта.

## Подтверждено

- TP: «Большая Татарская» v2, раздел фасадов: позиция 06.02.01.34 «Цементно-песчаная
  штукатурка М150 по сетке» без строк и без примечания, соседние позиции того же типа
  расценены.
- FP: ожидаются позиции, законно отданные заказчику, где инженер не успел написать
  обоснование, — лечится примечанием, а не вердиктом.

## Замер (2026-09-15)

База: 104 тендера, 105 143 позиции, 278 267 строк.

- Без условия на раздел правило давало **24 305 находок в 93 тендерах**: почти все —
  целиком нерасценённые разделы ВИС в незаконченных и архивных тендерах
  («Большая Татарская» v2 — 8 979, «Общежитие (деталировка ВИС)» — 1 207 при 0%
  расценки). Это не пропущенные строки.
- С условием «в разделе расценена хоть одна позиция» — 18 740 в 78 тендерах, шум тот же.
- С условием «раздел расценён не меньше чем наполовину» — **1 207 находок в 72 тендерах**.
