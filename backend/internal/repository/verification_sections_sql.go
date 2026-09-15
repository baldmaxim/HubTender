package repository

// SectionHashVersion — версия состава content_hash раздела. Меняется только
// осознанно: все отметки со старой версией станут «изменён после отметки».
const SectionHashVersion = 1

// sectionsSQL делит позиции тендера на разделы ВОР и считает по разделу
// статистику и content_hash.
//
// Раздел. client_positions.section_number при загрузке ВОР не заполняется, поэтому
// раздел выводится из иерархии так же, как сервер определяет заголовок в списке
// позиций: позиция — заголовок, если у следующей (не дополнительной) позиции
// уровень глубже. Разделами считаются заголовки ВЕРХНЕГО уровня из
// встречающихся: подразделы сворачиваются в свой раздел, иначе готовность
// дробилась бы до мелких групп. Позиции до первого заголовка — 'none',
// дополнительные позиции — 'additional'.
//
// content_hash. md5 по позициям и строкам раздела с явным перечнем полей — не
// to_jsonb(*): новая колонка в boq_items не должна переоткрывать все разделы.
// Не входят поля, которые меняются без правки расчёта инженером: updated_at,
// коммерческие суммы и наценка (их переписывает пересчёт) и ссылки/даты
// источника цены (правка метаданных, см. isQuoteMetadataOnlyPatch). total_amount
// входит: его меняет смена курса валюты, а это реальное изменение денег.
// NULL кодируется явным '∅' — concat_ws молча пропускает NULL и склеил бы
// разные наборы значений в одну строку.
const sectionsSQL = `
WITH base AS (
	SELECT cp.id, cp.position_number, cp.item_no, cp.work_name, cp.unit_code, cp.volume,
	       cp.manual_volume, cp.manual_note,
	       COALESCE(cp.hierarchy_level, 0) AS lvl,
	       COALESCE(cp.is_additional, false) AS is_add
	FROM public.client_positions cp
	WHERE cp.tender_id = $1
),
nxt AS (
	SELECT id, LEAD(lvl) OVER (ORDER BY position_number, id) AS next_lvl
	FROM base
	WHERE NOT is_add
),
marked AS (
	SELECT b.*, COALESCE(n.next_lvl > b.lvl, false) AS is_header
	FROM base b
	LEFT JOIN nxt n ON n.id = b.id
),
top AS (
	SELECT min(lvl) AS top_lvl FROM marked WHERE is_header
),
flagged AS (
	SELECT m.*, (m.is_header AND m.lvl = t.top_lvl) AS is_top
	FROM marked m
	CROSS JOIN top t
),
grouped AS (
	SELECT f.*,
	       count(*) FILTER (WHERE f.is_top)
	         OVER (ORDER BY f.position_number, f.id
	               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
	FROM flagged f
),
heads AS (
	SELECT grp, id AS head_id, item_no AS head_no, work_name AS head_name
	FROM grouped
	WHERE is_top
),
rows AS (
	SELECT b.client_position_id AS pid,
	       COALESCE(sum(b.total_amount), 0) AS total,
	       md5(string_agg(concat_ws('|',
	           b.id::text, b.boq_item_type::text,
	           COALESCE(b.material_type::text, '∅'),
	           COALESCE(b.material_name_id::text, '∅'), COALESCE(b.work_name_id::text, '∅'),
	           COALESCE(b.unit_code, '∅'),
	           COALESCE(trim_scale(b.quantity)::text, '∅'),
	           COALESCE(trim_scale(b.base_quantity)::text, '∅'),
	           COALESCE(trim_scale(b.consumption_coefficient)::text, '∅'),
	           COALESCE(trim_scale(b.conversion_coefficient)::text, '∅'),
	           COALESCE(b.delivery_price_type::text, '∅'),
	           COALESCE(trim_scale(b.delivery_amount)::text, '∅'),
	           COALESCE(b.currency_type::text, '∅'),
	           COALESCE(trim_scale(b.unit_rate)::text, '∅'),
	           COALESCE(trim_scale(b.total_amount)::text, '∅'),
	           COALESCE(b.detail_cost_category_id::text, '∅'),
	           COALESCE(b.parent_work_item_id::text, '∅'),
	           COALESCE(b.description, '∅')), '#' ORDER BY b.id)) AS h
	FROM public.boq_items b
	WHERE b.tender_id = $1
	GROUP BY b.client_position_id
),
sec AS (
	SELECT CASE WHEN g.is_add THEN 'additional'
	            WHEN g.grp = 0 THEN 'none'
	            ELSE 'h:' || h.head_id::text END AS section_key,
	       CASE WHEN g.is_add THEN 'Дополнительные позиции'
	            WHEN g.grp = 0 THEN 'Без раздела'
	            ELSE concat_ws(' ', NULLIF(btrim(h.head_no), ''), h.head_name) END AS title,
	       CASE WHEN g.is_add OR g.grp = 0 THEN NULL ELSE h.head_id END AS head_id,
	       g.id, g.position_number, g.item_no, g.work_name, g.unit_code, g.volume,
	       g.manual_volume, g.manual_note, g.lvl, g.is_add, g.is_header,
	       r.total, r.h
	FROM grouped g
	LEFT JOIN heads h ON h.grp = g.grp
	LEFT JOIN rows r ON r.pid = g.id
)
SELECT section_key,
       min(title) AS title,
       min(head_id::text) AS head_id,
       min(position_number) AS first_position_number,
       count(*) FILTER (WHERE NOT is_header)::int AS positions,
       count(*) FILTER (WHERE NOT is_header AND COALESCE(total, 0) > 0)::int AS priced,
       count(*) FILTER (WHERE NOT is_header AND COALESCE(total, 0) = 0
                          AND COALESCE(volume, 0) > 0
                          AND COALESCE(btrim(manual_note), '') = '')::int AS unpriced_no_reason,
       count(*) FILTER (WHERE NOT is_header AND COALESCE(total, 0) > 0
                          AND COALESCE(manual_volume, 0) = 0)::int AS priced_no_gp,
       COALESCE(sum(total), 0)::float8 AS total_amount,
       md5(string_agg(concat_ws('|',
           id::text, COALESCE(item_no, '∅'), COALESCE(work_name, '∅'),
           COALESCE(unit_code, '∅'),
           COALESCE(trim_scale(volume)::text, '∅'),
           COALESCE(trim_scale(manual_volume)::text, '∅'),
           COALESCE(manual_note, '∅'), lvl::text, is_add::text,
           COALESCE(h, '∅')), '~' ORDER BY position_number, id)) AS content_hash,
       array_agg(id::text ORDER BY position_number, id) AS position_ids
FROM sec
GROUP BY section_key
ORDER BY min(position_number)`

const sectionStatesSQL = `
SELECT s.section_key, s.stage, s.content_hash, s.hash_version, s.note,
       s.marked_by::text, u.full_name, s.marked_at
FROM public.verification_section_states s
LEFT JOIN public.users u ON u.id = s.marked_by
WHERE s.tender_id = $1`

// sectionChangesSQL — правки строк раздела после отметки, с авторами. Правки
// полей самой позиции (Кол-во ГП, примечание) аудитом не пишутся: при таких
// правках хеш разошёлся, а счётчик правок строк может быть нулём.
// Условие по двум индексированным выражениям (idx_audit_new_position,
// idx_audit_old_position): удалённая строка видна только в old_data.
const sectionChangesSQL = `
SELECT count(*)::int,
       max(a.changed_at),
       COALESCE(array_agg(DISTINCT u.full_name) FILTER (WHERE u.full_name IS NOT NULL), '{}')
FROM public.boq_items_audit a
LEFT JOIN public.users u ON u.id = a.changed_by
WHERE ((a.new_data ->> 'client_position_id') = ANY($1::text[])
    OR (a.old_data ->> 'client_position_id') = ANY($1::text[]))
  AND a.changed_at > $2`

// sectionFindingsSQL — незакрытые и не принятые находки последнего сохранённого
// прогона, по позициям. Принятой считается находка с вердиктом accepted на
// том же отпечатке — ровно как на странице находок.
const sectionFindingsSQL = `
SELECT f.client_position_id::text, f.severity, count(*)::int
FROM public.verification_findings f
LEFT JOIN public.quality_acknowledgements a
       ON a.tender_id = f.tender_id AND a.rule_code = f.rule_code
      AND a.entity_id = f.entity_id AND a.fingerprint = f.fingerprint
      AND a.verdict = 'accepted'
WHERE f.tender_id = $1
  AND f.resolved_at IS NULL
  AND f.client_position_id IS NOT NULL
  AND f.rule_code = ANY($2::text[])
  AND a.id IS NULL
GROUP BY 1, 2`
