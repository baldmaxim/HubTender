---
code: E
title: Строка в валюте, у которой нет курса в тендере
severity: error
money: no
status: active
---
## Суть

**Страж регресса.** На проде даёт ноль и должен оставаться нулевым. Ненулевой результат
означает, что сломался инвариант, а не что «нашлись ошибки».

Строка номинирована в USD, EUR или CNY, а у тендера курс этой валюты не задан или
не положителен. Пересчитать сумму в рубли нечем: расчётное ядро в таком случае
блокирующе падает (`MISSING_FX_RATE`), а экспорт в Excel отказывается формировать файл.

Если правило сработало — сначала проставьте курс в тендере, всё остальное считать
бессмысленно.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.currency_type::text, t.usd_rate, t.eur_rate, t.cny_rate)) AS fingerprint,
  concat_ws(' ',
    'Валюта строки', b.currency_type::text,
    '— курс в тендере не задан; цена за единицу',
    round(COALESCE(b.unit_rate, 0), 2)::text) AS detail,
  NULL::numeric AS money_delta
FROM public.boq_items b
JOIN public.tenders t ON t.id = b.tender_id
JOIN public.client_positions cp ON cp.id = b.client_position_id
WHERE b.tender_id = $1
  AND b.currency_type::text IN ('USD', 'EUR', 'CNY')
  AND COALESCE(
        CASE b.currency_type::text
          WHEN 'USD' THEN t.usd_rate
          WHEN 'EUR' THEN t.eur_rate
          WHEN 'CNY' THEN t.cny_rate
        END, 0) <= 0
ORDER BY cp.position_number
```

## Подтверждено

- TP: не зафиксировано (и не должно).
- FP: невозможен — валюта без курса не считается ни в одном сценарии.

## Замер (2026-07-24)

0 строк. Инвариант держится.
