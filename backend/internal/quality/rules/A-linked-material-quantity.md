---
code: A
title: Количество привязанного материала не выведено из работы
severity: error
money: yes
status: active
---
## Суть

Материал привязан к работе, значит его количество должно получаться как
`количество работы × коэфф. перевода × коэфф. расхода`. Здесь оно другое: связь есть,
а количество живёт своей жизнью.

Причины бывают разные, и они требуют **разного** лечения — поэтому правило только
показывает расхождение, но не предлагает автоматический пересчёт:

- **Устарело количество материала.** Работу изменили, а пересчёт привязанных
  материалов не отработал. Лечится пересчётом материала.
- **Материал считали не от работы.** Количество выведено из объёма позиции или введено
  вручную, а привязка к работе служит группировкой. Тогда верно сохранённое значение,
  а пересчёт по формуле сломает данные.

Отличить одно от другого может только инженер. Показательный случай: «Река 4», позиция
08.02.06 — 14 материалов, у всех количество равно `объём позиции 89.47 × коэфф. перевода`,
а работы стоят по 1 шт. Пересчёт по формуле урезал бы грунтовку с 44.4 кг до 0.52 кг.

## SQL

```sql
SELECT
  b.tender_id,
  cp.position_number,
  cp.item_no,
  b.id AS entity_id,
  md5(concat_ws('|', b.quantity, w.quantity, b.conversion_coefficient,
                b.consumption_coefficient, b.unit_rate)) AS fingerprint,
  concat_ws(' ',
    'Количество ГП', round(COALESCE(b.quantity,0), 4)::text,
    '; формула «работа', round(COALESCE(w.quantity,0), 4)::text,
    '× перевод', round(COALESCE(NULLIF(b.conversion_coefficient,0), 1), 4)::text,
    '× расход', round(COALESCE(NULLIF(b.consumption_coefficient,0), 1), 4)::text,
    '» даёт', round(COALESCE(w.quantity,0)
        * COALESCE(NULLIF(b.conversion_coefficient,0), 1)
        * COALESCE(NULLIF(b.consumption_coefficient,0), 1), 4)::text) AS detail,
  round(
    (COALESCE(b.quantity,0)
      - COALESCE(w.quantity,0)
        * COALESCE(NULLIF(b.conversion_coefficient,0), 1)
        * COALESCE(NULLIF(b.consumption_coefficient,0), 1))
    * COALESCE(b.unit_rate,0)
    * CASE b.currency_type::text
        WHEN 'USD' THEN COALESCE(t.usd_rate,1)
        WHEN 'EUR' THEN COALESCE(t.eur_rate,1)
        WHEN 'CNY' THEN COALESCE(t.cny_rate,1)
        ELSE 1 END
  , 2) AS money_delta
FROM public.boq_items b
JOIN public.boq_items w ON w.id = b.parent_work_item_id
JOIN public.client_positions cp ON cp.id = b.client_position_id
JOIN public.tenders t ON t.id = b.tender_id
WHERE b.tender_id = $1
  AND b.boq_item_type::text LIKE '%мат%'
  AND abs(
        COALESCE(b.quantity,0)
        - COALESCE(w.quantity,0)
          * COALESCE(NULLIF(b.conversion_coefficient,0), 1)
          * COALESCE(NULLIF(b.consumption_coefficient,0), 1)
      ) > 0.01
ORDER BY abs(COALESCE(b.quantity,0)
  - COALESCE(w.quantity,0) * COALESCE(NULLIF(b.conversion_coefficient,0),1)
    * COALESCE(NULLIF(b.consumption_coefficient,0),1)) DESC
```

## Подтверждено

- TP: «Событие 6.1» v1/v2, позиция 12.01.01 — установка насоса COR-3 MVL 419 стоит 1
  при работе «Монтаж насоса повысительного» = 4. В v3 количество исправили на 4.
- FP: «Река 4», позиция 08.02.06 — 14 материалов выведены из объёма позиции (89.47),
  а не из работы; работы там по 1 шт, и это их настоящее количество. Сохранённые
  количества верные, пересчёт по формуле их разрушит.
- FP: «ЖК Cityzen», позиции 2038 и 2062 — оборудование комплектом (ГП = 1 при работе
  217 и 101, цена 37 и 11 млн ₽). Формула дала бы 8 млрд ₽.

## Замер (2026-07-24)

526 строк в 58 тендерах. Из них 181 несёт признак вставки шаблона (`base_quantity = 1`
у привязанного материала — шаблон до правки писал количество от объёма позиции).
