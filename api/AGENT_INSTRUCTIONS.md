# TenderHUB — доступ к тендерам и сметам по API-ключу

Скопируйте этот текст в `AGENTS.md` (Codex), правило Cursor или `CLAUDE.md`.

---

Когда нужно найти тендер, посмотреть его позиции, итоги, КП или строки сметы,
используй CLI `scripts/archive-api.mjs` (Node 18+). Он читает ключ из окружения —
**никогда не вставляй ключ в команду, файл, лог или сообщение**. Если переменной
`TENDERHUB_API_KEY` нет — скажи об этом и не пытайся обойти.

## Команды

```bash
# 1. выбрать тендер: id, номер, название, заказчик, версия, архив
node scripts/archive-api.mjs tenders --search="ЖК Север" --archived=false

# 2. шапка тендера: курсы, итог КП, число позиций и строк
node scripts/archive-api.mjs tender <tender_id>

# 3. позиции с итогами: себестоимость (base_total), КП (commercial_total),
#    наценка, число строк — всё, что видит инженер на странице позиций
node scripts/archive-api.mjs costs <tender_id>

# 3a. позиции с признаком раздела (is_section) и категорией затрат
#     (cost_category_name — «МОНОЛИТНЫЕ РАБОТЫ», «КРОВЛЯ»…); --section фильтрует
node scripts/archive-api.mjs positions <tender_id> --section=монолит

# 4. детальная смета: строки работ/материалов с названиями, единицами, количеством,
#    ценой, валютой, категорией затрат и коммерческой стоимостью
node scripts/archive-api.mjs estimate <tender_id>                  # весь тендер
node scripts/archive-api.mjs estimate x --position=<position_id>   # одна позиция

# архив исторических смет (если выдана область archive:read)
node scripts/archive-api.mjs search "устройство стяжки" --unit=м2 --limit=10
node scripts/archive-api.mjs position <position_id>

# спецификация OpenAPI
node scripts/archive-api.mjs spec
```

Прямой HTTP: base `https://tender.su10.ru`, заголовок `X-API-Key`, ответы в
`{"data": …}`. Маршруты чтения: `GET /api/v1/tenders/brief`,
`/api/v1/tenders/{id}/overview`, `/api/v1/tenders/{id}/positions/with-costs`,
`/api/v1/tenders/{id}/positions`, `/api/v1/tenders/{id}/boq-items-full`,
`/api/v1/positions/{id}/boq-items-full`.

## Как читать данные

- Позиция (`client_positions`) — строка ВОР заказчика: `item_no`, `work_name`,
  `unit_code`, `volume`, `client_note`. `is_section: true` — заголовок раздела, не
  считать её работой. `is_additional` — дополнительная (ДОП) позиция.
- Строка сметы (`boq_items`) — работа или материал внутри позиции: `boq_item_type`
  (`раб`, `суб-раб`, `мат`, `суб-мат`, `…-комп.`), название в
  `work_names.name` / `material_names.name` (или `description`), `quantity`,
  `unit_rate` в `currency_type`, `total_amount` — себестоимость строки,
  `total_commercial_*` — коммерческая стоимость.
- Итоги тендера: `cached_grand_total` в шапке; по позициям — `commercial_total`.
- Раздел сметы («монолит», «кровля») — это `cost_category_name` позиции или
  `detail_cost_categories.cost_categories.name` строки, а **не** `hierarchy_level`
  и не `construction_scope` тендера.
- Цены и суммы не пересчитывай сам и не конвертируй валюты — показывай, что отдал сервер.

## Правила

1. Ключ для просмотра — только чтение. Не пытайся создавать или менять строки; если
   пользователь просит записать — скажи, что нужен отдельный ключ с правом записи.
2. Крупные тендеры: `estimate` на весь тендер может весить десятки мегабайт — если нужна
   часть, сначала `positions`/`costs`, затем `estimate --position=<id>` по нужным.
3. Не повторяй запрос «на всякий случай» после ошибки — сначала прочитай её код.

## Ошибки

| Код | Что делать |
|---|---|
| 401 | ключа нет, отозван или просрочен — попросить выпустить новый в «Настройки → Доступ к API» |
| 403 `API_KEY_SCOPE_DENIED` | ключу не выдана область (для просмотра нужна `tenders:read`) — попросить перевыпуск, не обходить |
| 403 `API_KEY_TENDER_DENIED` | тендер вне списка разрешённых для ключа |
| 429 | лимит запросов в минуту — снизить темп |
| 503 `ENDPOINT_DISABLED` | администратор выключил эндпоинт; не обходить |
| ответ не JSON | ответил прокси — проверить `TENDERHUB_API_URL` |
