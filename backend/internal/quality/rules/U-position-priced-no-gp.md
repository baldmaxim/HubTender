---
code: U
title: Позиция расценена, но Количество ГП не задано
severity: error
money: no
status: draft
---
## Суть

В позицию занесены деньги — сумма её строк больше нуля, — а собственное
«Количество ГП» осталось нулевым или пустым.

Отличие от правила **H**: там строки есть, но денег нет, и это чаще заготовка,
которую ещё не расценили. Здесь позиция уже вошла в цену, и форма КП выйдет к
заказчику со стоимостью, но без объёма генподряда. Цена за единицу по такой
строке не считается, а промежуточные итоги по разделу перестают биться с
объёмами.

Это ровно тот пункт ручной проверки, который звучит как «количество ГП должно
стоять во всех расценённых строках».

## SQL

```sql
SELECT
  cp.tender_id,
  cp.position_number,
  cp.item_no,
  cp.id AS entity_id,
  md5(concat_ws('|', trim_scale(COALESCE(cp.manual_volume, 0)),
                trim_scale(round(COALESCE(SUM(b.total_amount), 0), 2)),
                COALESCE(cp.unit_code, ''))) AS fingerprint,
  concat_ws(' ',
    'Позиция расценена на', round(COALESCE(SUM(b.total_amount), 0), 2)::text,
    '₽, Кол-во ГП не задано; строк:', COUNT(b.id)::text,
    '; количество заказчика:',
    COALESCE(round(cp.volume, 4)::text, 'тоже не задано')) AS detail,
  NULL::numeric AS money_delta
FROM public.client_positions cp
JOIN public.boq_items b ON b.client_position_id = cp.id
WHERE cp.tender_id = $1
  AND COALESCE(cp.manual_volume, 0) = 0
GROUP BY cp.tender_id, cp.position_number, cp.item_no, cp.id,
         cp.manual_volume, cp.unit_code, cp.volume
HAVING COALESCE(SUM(b.total_amount), 0) > 0
ORDER BY cp.position_number
```

Отпечаток — `manual_volume`, сумма позиции с округлением до копейки и единица
измерения. Округление намеренное: копеечная правка соседней строки не должна
снимать подтверждение, а появление денег там, где их не было, — должна.

## Подтверждено

- TP: не снято — правило в статусе `draft`.
- FP: ожидаются позиции-разделы, куда строки попали ошибочно (тот же класс FP,
  что у правила H).

## Замер

Не снят. Правило заведено черновиком и не выполняется, пока прогон на проде не
подтвердит число находок и не найдётся хотя бы один TP.

Вместе с этим правилом нужно перезамерить **H**: после сужения H до
`SUM(total_amount) = 0` его нынешние 929 находок распадутся на две группы, и
пространство между H и U перестанет пересекаться.
