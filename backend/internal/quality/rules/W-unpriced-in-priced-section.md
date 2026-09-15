---
code: W
title: Нерасценённая позиция внутри расценённого раздела
severity: warning
money: no
status: draft
entity_type: client_position
---
## Суть

Целиком нерасценённый раздел — законная ситуация: этот объём не наш. А одна
пустая позиция среди девяноста расценённых — почти всегда пропуск, а не решение.

Правило смотрит не на позицию саму по себе, а на её окружение: если в разделе
расценено подавляющее большинство позиций, а эта пустая, её стоит перепроверить.
Это и есть «нерасценённые строки, которые инженера упустили».

Раздел выводится из иерархии, а не из `section_number`: последнее поле при
загрузке ВОР не заполняется (его пишет только сборка из архива смет), поэтому
за границу раздела берётся ближайшая предшествующая позиция-заголовок — та, у
которой следующая позиция глубже по уровню.

Пороги (не меньше 5 позиций в разделе, расценено не меньше 80%) — гипотеза,
подлежащая замеру.

## SQL

```sql
WITH marked AS (
  SELECT cp.id, cp.tender_id, cp.position_number, cp.item_no, cp.work_name,
         cp.section_number,
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
),
grouped AS (
  SELECT m.*,
         COUNT(*) FILTER (WHERE m.is_section)
           OVER (ORDER BY m.position_number, m.id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp_no
  FROM marked m
),
headers AS (
  SELECT g.grp_no,
         MIN(COALESCE(NULLIF(btrim(g.item_no), ''), g.work_name)) AS header_label
  FROM grouped g
  WHERE g.is_section
  GROUP BY g.grp_no
),
leaves AS (
  SELECT g.id, g.tender_id, g.position_number, g.item_no,
         -- ключ группировки и подпись разведены: у section_number и у выведенного
         -- заголовка разные пространства значений, и склеивать их нельзя —
         -- раздел «1» из ведомости и заголовок с номером «1» это разные разделы.
         CASE WHEN NULLIF(btrim(g.section_number), '') IS NOT NULL
              THEN 's:' || btrim(g.section_number)
              ELSE 'h:' || COALESCE(h.header_label, '') END AS section_key,
         COALESCE(NULLIF(btrim(g.section_number), ''),
                  h.header_label, 'без раздела') AS section_label,
         COALESCE((SELECT SUM(b.total_amount) FROM public.boq_items b
                   WHERE b.client_position_id = g.id), 0) AS total
  FROM grouped g
  LEFT JOIN headers h ON h.grp_no = g.grp_no
  WHERE g.is_section = false
),
stat AS (
  SELECT section_key,
         COUNT(*) AS n,
         COUNT(*) FILTER (WHERE total > 0) AS priced
  FROM leaves
  GROUP BY section_key
)
SELECT
  l.tender_id,
  l.position_number,
  l.item_no,
  l.id AS entity_id,
  md5(concat_ws('|', trim_scale(l.total), s.priced::text, s.n::text,
                l.section_key)) AS fingerprint,
  concat_ws(' ',
    'В разделе «' || l.section_label || '» расценено', s.priced::text,
    'из', s.n::text, 'позиций, эта — нет') AS detail,
  NULL::numeric AS money_delta
FROM leaves l
JOIN stat s ON s.section_key = l.section_key
WHERE l.total = 0
  AND s.n >= 5
  AND s.priced::numeric / s.n >= 0.80
ORDER BY l.position_number
```

Отпечаток включает статистику раздела: расценили соседей — доля изменилась —
находка переоткрывается осознанно, а не от случайной правки.

## Подтверждено

- TP: не снято — правило в статусе `draft`.
- FP: ожидаются разделы, где несколько позиций законно отданы заказчику
  (давальческий материал, работы вне объёма ГП).

## Замер

Не снят. Пороги 5 и 0.80 подобраны по аналогии и обязаны быть перепроверены
замером: поднимаем порог — пересматриваем и покрытие, и число находок.
