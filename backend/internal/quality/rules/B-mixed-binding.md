---
code: B
title: В позиции материалы привязаны частично
severity: warning
money: no
status: active
---
## Суть

В одной позиции часть материалов привязана к работам, а часть нет. Само по себе это
не ошибка — так бывает законно. Но это та конфигурация, в которой количества
разъезжаются: привязанный материал получает количество от работы, непривязанные
остаются со своими, и общая картина по позиции перестаёт сходиться.

Именно так возникло расхождение в «Событие 6.1»: под работой «Монтаж насоса
повысительного» = 4 лежали четыре модели насосов по 1 шт, привязали одну — и её
количество система переписала с 1 на 4, а три остальные остались по 1. Итого семь
насосов на четыре монтажа.

Правило показывает конфигурацию, а не дефект: это повод проверить, осознанная ли
смесь. Раньше на эту же ситуацию с другой стороны указывало правило **T**, но оно
выключено — оказалось, что оно не отличает такую смесь от нормального комплекта
разных материалов под одной работой.

## SQL

```sql
WITH s AS (
  SELECT
    b.client_position_id,
    COUNT(*) FILTER (WHERE b.parent_work_item_id IS NOT NULL) AS linked,
    COUNT(*) FILTER (WHERE b.parent_work_item_id IS NULL)     AS unlinked
  FROM public.boq_items b
  WHERE b.tender_id = $1
    AND b.boq_item_type::text LIKE '%мат%'
  GROUP BY b.client_position_id
)
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', s.linked, s.unlinked)) AS fingerprint,
  concat_ws(' ',
    'Материалов привязано к работам:', s.linked::text,
    ', без привязки:', s.unlinked::text) AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
JOIN s ON s.client_position_id = cp.id
WHERE cp.tender_id = $1
  AND s.linked > 0
  AND s.unlinked > 0
ORDER BY cp.position_number
```

## Подтверждено

- TP (как контекст): «Событие 6.1», позиция 12.01.01 — один насос COR-3 привязан,
  три остались без привязки. Именно эта смесь и породила расхождение 7 против 4.
- FP: массово. Смешанная привязка сама по себе нормальна, поэтому severity `warning`
  и правило не считает денежный эффект.

## Замер (2026-07-24)

1 543 позиции в 76 тендерах.
