---
code: I
title: Итоговая сумма строки не совпадает с пересчётом
severity: error
money: yes
status: active
---
## Суть

Сохранённая в базе `total_amount` строки разошлась с тем, что даёт расчётное ядро из
её же полей (количество, цена, курс, доставка, коэффициент расхода). Значит сумма
устарела: её посчитали при одних значениях, потом поля изменили, а пересчёт не прошёл.

Такая строка врёт в отчётах и выгрузках, которые читают сохранённую сумму, хотя
страница «Позиции заказчика» считает на лету и покажет другое число.

**Допуск ≥ 100 ₽ — часть правила, а не оптимизация.** Пороги замерены на всей базе:

| Допуск | Находок | Тендеров | Сумма расхождений |
|--:|--:|--:|--:|
| ≥ 1 ₽ | 2 568 | 59 | −106 318 690 ₽ |
| ≥ 10 ₽ | 1 175 | 40 | −106 318 954 ₽ |
| **≥ 100 ₽** | **621** | **21** | **−106 321 422 ₽** |
| ≥ 1 000 ₽ | 501 | 18 | −106 306 457 ₽ |

Переход с 1 ₽ на 100 ₽ убирает 1 947 находок и **не теряет ни рубля** покрытия —
денежный эффект тот же. Всё ниже сотни рублей это либо арифметика с плавающей точкой
(без допуска правило даёт 28 737 находок), либо копеечные хвосты, за которыми нет
управленческого смысла. Порог 1 000 ₽ уже начинает срезать реальные строки.

## SQL

```sql
WITH r AS (
  SELECT
    b.id, b.tender_id, b.client_position_id,
    b.boq_item_type::text            AS bt,
    COALESCE(b.quantity, 0)          AS q,
    COALESCE(b.unit_rate, 0)         AS ur,
    b.delivery_price_type::text      AS dt,
    COALESCE(b.delivery_amount, 0)   AS da,
    COALESCE(NULLIF(b.consumption_coefficient, 0), 1) AS cons,
    b.parent_work_item_id            AS pw,
    COALESCE(b.total_amount, 0)      AS stored,
    CASE b.currency_type::text
      WHEN 'USD' THEN COALESCE(t.usd_rate, 1)
      WHEN 'EUR' THEN COALESCE(t.eur_rate, 1)
      WHEN 'CNY' THEN COALESCE(t.cny_rate, 1)
      ELSE 1
    END AS fx
  FROM public.boq_items b
  JOIN public.tenders t ON t.id = b.tender_id
  WHERE b.tender_id = $1
),
calc AS (
  SELECT r.*,
    CASE
      WHEN bt LIKE '%раб%' THEN q * ur * fx
      WHEN bt LIKE '%мат%' THEN
        q * (CASE WHEN pw IS NOT NULL THEN 1 ELSE cons END)
          * (ur * fx + CASE dt
                         WHEN 'не в цене' THEN ur * fx * 0.03
                         WHEN 'суммой'    THEN da
                         ELSE 0
                       END)
      ELSE stored
    END AS recomputed
  FROM r
)
SELECT
  c.tender_id,
  cp.position_number,
  cp.item_no,
  c.id AS entity_id,
  md5(concat_ws('|', c.q, c.ur, c.stored, c.da, c.cons, c.dt, c.fx)) AS fingerprint,
  concat_ws(' ',
    'Сохранено', round(c.stored, 2)::text, '₽, пересчёт даёт',
    round(c.recomputed, 2)::text, '₽ (расхождение',
    round(c.stored - c.recomputed, 2)::text, '₽)') AS detail,
  round(c.stored - c.recomputed, 2) AS money_delta
FROM calc c
JOIN public.client_positions cp ON cp.id = c.client_position_id
WHERE abs(c.stored - c.recomputed) >= 100
ORDER BY abs(c.stored - c.recomputed) DESC
```

## Подтверждено

- TP: расхождения на 105.5 млн ₽ суммарно; 345 строк в 11 тендерах расходятся более
  чем на 10 000 ₽ каждая — это не округление, а устаревшие суммы.
- FP: не зафиксировано. Расхождение ≥ 1 ₽ на неизменных входных данных всегда означает,
  что пересчёт не отработал.

## Замер (2026-07-24)

**621 строка в 21 тендере, суммарное расхождение −106 321 422 ₽.**

Распределение: 276 строк в диапазоне 100–10 000 ₽ (−761 109 ₽), 345 строк свыше
10 000 ₽ (−105 560 313 ₽). Крупнейшая одиночная находка — «Река 4 v7», позиция
12.03.02.02: сохранено 251 173 805 ₽ при пересчёте 267 305 616 ₽, расхождение
−16 131 811 ₽.

Отброшено допуском: 26 169 строк с расхождением < 1 ₽ (арифметика с плавающей точкой)
и 1 947 строк в диапазоне 1–100 ₽ (совокупно +2 732 ₽).

На «Река 4 v7» правило даёт 143 находки — проверка на отсутствие шумового срабатывания.
