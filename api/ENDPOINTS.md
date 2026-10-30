# Справочник эндпоинтов машинного доступа

Авторизация — заголовок `X-API-Key: thk_…`. `Authorization: Bearer <JWT>` — это путь
человека с сессией портала; ключ в этом заголовке не работает и даёт
`401 invalid or expired token` (разбор — в [README.md](README.md#ошибки-и-диагностика)).
Конверт ответа — `{"data": …}`, у постраничных списков ещё `next_cursor`.
Ошибки — RFC 7807 с полем `code`. Точные схемы — в OpenAPI:
`GET /api/v1/archive/openapi.yaml`.

**Чего у ключа нет.** Открыты только перечисленные ниже маршруты и маршруты из
[VERIFICATION.md](VERIFICATION.md) («Проверка данных») и [REGISTRY.md](REGISTRY.md)
(«Перечень тендеров» для Telegram-бота). В частности,
`GET /api/v1/tenders` (список тендеров для UI) ключу **недоступен** — он под JWT;
машинный список это `GET /api/v1/tenders/brief`. Админские
`/api/v1/admin/api-access/*` и остальные эндпоинты портала ключу тоже закрыты.

## Все маршруты — 36 операций

| Метод | Путь | Область |
|---|---|---|
| GET | `/api/v1/tenders/brief` | `tenders:read` |
| GET | `/api/v1/tenders/{id}/overview` | `tenders:read` |
| GET | `/api/v1/tenders/{id}/positions` | `tenders:read` |
| GET | `/api/v1/tenders/{id}/positions/with-costs` | `tenders:read` |
| GET | `/api/v1/tenders/{id}/positions/{posId}/items` | `tenders:read` |
| GET | `/api/v1/tenders/{id}/boq-items-full` | `tenders:read` |
| GET | `/api/v1/positions/{id}/boq-items-full` | `tenders:read` |
| GET | `/api/v1/items/{id}` | `tenders:read` |
| POST | `/api/v1/tenders/{id}/positions/{posId}/items` | `tenders:write` |
| PATCH | `/api/v1/items/{id}` | `tenders:write` |
| POST | `/api/v1/positions/{id}/recompute-totals` | `tenders:write` |
| POST | `/api/v1/autoprice-runs/{sid}/items:bulk` | `tenders:write` |
| POST | `/api/v1/nomenclature/ensure` | `nomenclature:write` |
| GET | `/api/v1/archive/positions/search` | `archive:read` |
| POST | `/api/v1/archive/positions/suggest` | `archive:read` |
| GET | `/api/v1/archive/positions/{id}` | `archive:read` |
| POST | `/api/v1/archive/compose` | `archive:write` |
| GET | `/api/v1/archive/openapi.yaml` | любая (нужен ключ) |
| GET | `/api/v1/tenders/{id}/quality` | `verification:read` |
| GET | `/api/v1/quality/rules` | `verification:read` |
| GET | `/api/v1/tenders/{id}/verification/sections` | `verification:read` |
| GET | `/api/v1/tenders/{id}/cost-benchmarks` | `verification:read` |
| GET | `/api/v1/benchmark-ranges` | `verification:read` |
| GET | `/api/v1/tenders/{id}/brief` | `verification:read` |
| GET | `/api/v1/tenders/{id}/verification/ai-assessments` | `verification:read` |
| POST | `/api/v1/tenders/{id}/quality/verdict` | `verification:write` |
| POST | `/api/v1/tenders/{id}/quality/verdicts` | `verification:write` |
| POST | `/api/v1/tenders/{id}/quality/checkpoint` | `verification:write` |
| POST | `/api/v1/tenders/{id}/verification/sections/mark` | `verification:write` |
| POST | `/api/v1/tenders/{id}/verification/sections/unmark` | `verification:write` |
| PUT | `/api/v1/tenders/{id}/brief` | `verification:write` |
| POST | `/api/v1/tenders/{id}/verification/ai-triage` | `verification:write` |
| GET | `/api/v1/tender-registry/search` | `registry:read` |
| GET | `/api/v1/tender-registry/{id}/card` | `registry:read` |
| POST | `/api/v1/tender-registry/reminders/claim` | `registry:write` |
| POST | `/api/v1/tender-registry/{id}/chronology` | `registry:write` |

Тендеры и архив описаны ниже, проверка данных — в [VERIFICATION.md](VERIFICATION.md),
перечень — в [REGISTRY.md](REGISTRY.md).

## Чтение тендеров и смет — область `tenders:read`

### `GET /api/v1/tenders/brief` — список тендеров

Выбор цели. Без страниц (до 1000 строк), порядок — номер тендера, свежая версия первой.
Ключ с ограничением по тендерам видит только их.

| Параметр | |
|---|---|
| `search` | подстрока без учёта регистра по названию, заказчику и номеру |
| `is_archived` | `true` / `false` |

Строка: `id, tender_number, title, client_name, version, is_archived, housing_class,
construction_scope, submission_deadline, updated_at`.

`construction_scope` (`генподряд` / `коробка` / `монолит`) — объём строительства
тендера, не раздел сметы.

### `GET /api/v1/tenders/{id}/overview` — шапка

`id, tender_number, title, client_name, housing_class, construction_scope, is_archived,
cached_grand_total` (итог КП), `usd_rate, eur_rate, cny_rate, position_count,
boq_item_count, created_at, updated_at`.

### `GET /api/v1/tenders/{id}/positions/with-costs` — позиции с итогами и КП

Весь тендер одним массивом (без страниц; ~10 МБ на 11 тыс. позиций, gzip), порядок
`position_number`. Кэш 30 с, сбрасывается заголовком `Cache-Control: no-cache`.

Поля позиции: `id, tender_id, position_number, item_no, work_name, client_note,
unit_code, volume, manual_volume, manual_note, hierarchy_level, is_additional,
parent_position_id, total_material, total_works, material_cost_per_unit,
work_cost_per_unit, total_commercial_material, total_commercial_work,
total_commercial_material_per_unit, total_commercial_work_per_unit, rich_runs,
created_at, updated_at`.

Агрегаты по строкам: `base_total` (себестоимость), `commercial_total` (КП),
`material_cost_total, work_cost_total, markup_percentage, items_count`.

### `GET /api/v1/tenders/{id}/positions` — позиции с признаками раздела

Постранично: `limit` (1–200, по умолчанию 50), `cursor` из `next_cursor`. Порядок
`updated_at DESC` — для иерархии заберите все страницы и отсортируйте по
`position_number` (CLI `positions` делает это сам).

Поля — уже, чем у `with-costs`: `id, tender_id, position_number, item_no, work_name,
client_note, unit_code, volume, manual_volume, manual_note, hierarchy_level,
is_additional, parent_position_id, total_material, total_works, section_number,
position_name, created_at, updated_at`. Удельных и коммерческих стоимостей, `rich_runs`
и агрегатов по строкам здесь нет — за ними идите в `with-costs`. Плюс два производных:

- `is_section` — заголовок раздела, а не исполняемая позиция (следующая
  не-дополнительная позиция лежит глубже по `hierarchy_level`);
- `cost_category_id`, `cost_category_name` — раздел сметы по строкам позиции: самая
  частая категория затрат (`МОНОЛИТНЫЕ РАБОТЫ`, `КРОВЛЯ`, …); `null`, пока позиция не
  расценена. Именно по нему отбирают «монолит».

### `GET /api/v1/tenders/{id}/boq-items-full` — все строки сметы

Самый тяжёлый маршрут: все `boq_items` тендера без страниц и кэша, порядок
`sort_number, id`. Для одной позиции — `GET /api/v1/positions/{id}/boq-items-full`
(тот же формат).

Строка: `id, tender_id, client_position_id, sort_number, boq_item_type`
(`мат`/`суб-мат`/`мат-комп.`/`раб`/`суб-раб`/`раб-комп.`), `material_type`
(`основн.`/`вспомогат.`), `description, unit_code, quantity, base_quantity,
consumption_coefficient, conversion_coefficient, unit_rate, currency_type,
delivery_price_type, delivery_amount, total_amount, commercial_markup,
total_commercial_material_cost, total_commercial_work_cost, detail_cost_category_id,
material_name_id, work_name_id, parent_work_item_id, quote_link, import_session_id,
created_at, updated_at`.

Вложенные справочники (могут быть `null`): `work_names {name, unit}`,
`material_names {name, unit}`, `parent_work {work_names {name}}` (работа, к которой
привязан материал), `detail_cost_categories {name, location, cost_categories {name}}`.

### `GET /api/v1/tenders/{id}/positions/{posId}/items` — сырые строки позиции

Без страниц, порядок `sort_number`. Те же скаляры, что выше, без вложенных имён и
коммерческих стоимостей, плюс `quote_price_date, quote_valid_until`. Нужен, чтобы
перед записью увидеть, что уже есть.

### `GET /api/v1/items/{id}` — одна строка BOQ

Сырая строка и заголовок `ETag` (для `If-Match` при PATCH). Тендер для ограничения
ключа определяется по строке в базе.

## Архив смет — области `archive:read` / `archive:write`

| Метод | Путь | Область | Назначение |
|---|---|---|---|
| GET | `/api/v1/archive/positions/search?q=…` | `archive:read` | похожие исторические позиции |
| POST | `/api/v1/archive/positions/suggest` | `archive:read` | батч-подбор, до 100 запросов в теле (потолок настраивается) |
| GET | `/api/v1/archive/positions/{id}` | `archive:read` | историческая позиция + тендер + строки |
| POST | `/api/v1/archive/compose` | `archive:write` | сборка позиций целевого тендера |
| GET | `/api/v1/archive/openapi.yaml` | любая | спецификация; заголовок `X-API-Key` обязателен и здесь |

> **`compose` без `"dry_run": true` пишет в тендер.** Умолчание поля — `false`. Пробу
> без записи даёт только явное `"dry_run": true`. CLI `archive-api.mjs compose` ставит
> пробу сам и пишет лишь с флагом `--no-dry-run`.

Параметры `search`: `q` (обязателен), `unit_code`, `volume`, `item_no`, `limit`,
`min_score`, `exclude_tender_id`, `period_months`, `only_latest_version` (по умолчанию
`true`), `with_boq_only` (по умолчанию `true`), `approved_only` (по умолчанию `false`),
`candidate_limit`.

**Передавайте `limit` явно.** Без него `search` возвращает до потолка выдачи — 200
позиций; так же ведёт себя `limit_per_query` в `suggest`. Потолки задаёт администратор.

Подробно — [ARCHIVE.md](ARCHIVE.md): как считается похожесть, сценарий сборки, коды ошибок.

## Запись строк — область `tenders:write`

| Метод | Путь | Заметки |
|---|---|---|
| POST | `/api/v1/tenders/{id}/positions/{posId}/items` | обязателен `boq_item_type`; обычно `description, unit_code, quantity, unit_rate, currency_type`; `work_name_id`/`material_name_id` — опционально. Ответ 201 + `ETag` |
| PATCH | `/api/v1/items/{id}` | обязателен `If-Match` с ETag строки (`If-Match: *` — любая существующая версия); без заголовка 428, при расхождении 412 с полем `current_etag` |
| POST | `/api/v1/positions/{id}/recompute-totals` | после серии записей; ответ 204 без тела |

Идемпотентности нет: перед повтором читайте строки позиции. Суммы и коммерческие
стоимости считает сервер. Имена номенклатуры сервер не сопоставляет — либо текст в
`description`, либо готовые id.

### Пакетная запись строк прогона — `POST /api/v1/autoprice-runs/{sid}/items:bulk`

Область `tenders:write`; ключ с ограничением по тендерам должен включать тендер прогона
(`{sid}` — id прогона авторасценки, созданного `POST /api/v1/tenders/{id}/autoprice-runs`).
Заменяет серию `POST …/positions/{posId}/items` + `PUT …/autoprice-runs/{sid}/positions/{posId}/review`
(11 тыс. запросов на тендер): **одна транзакция на весь запрос** — записывается всё или ничего.

```json
{"positions":[
  {"position_id":"<uuid позиции тендера прогона>",
   "replace":true,
   "items":[
     {"ref":"w1","boq_item_type":"раб","work_name_id":"<uuid>","unit_code":"м2",
      "quantity":120,"unit_rate":850,"currency_type":"RUB"},
     {"ref":"m1","parent_ref":"w1","boq_item_type":"мат","material_name_id":"<uuid>","material_type":"основн.",
      "unit_code":"кг","quantity":14.5,"unit_rate":32,"currency_type":"RUB","delivery_price_type":"в цене",
      "conversion_coefficient":1,"consumption_coefficient":1}
   ],
   "review":{"basis":"ASSUMED","pd_refs":["лист 12"],"pd_note":"…","questions":[],"findings":[]}}
]}
```

- **Позиция.** `position_id` — позиция тендера прогона, в запросе не повторяется. `review` — как тело
  `PUT …/review` (`basis`, `pd_refs`, `pd_note`, `questions`, `findings`), `null` или отсутствует — карточку
  не менять; новая карточка `pending`, `returned` после загрузки снова `pending`.
- **Строка.** Поля те же, что у `POST …/items` (`boq_item_type`, `quantity`, `unit_rate`, `currency_type`,
  `work_name_id`/`material_name_id` и т. д.) и теми же проверками; у работы обязателен `work_name_id`, у материала —
  `material_name_id`. `import_session_id` не нужен — строки всегда пишутся в прогон `{sid}`. Коммерческих полей
  (наценок) нет: итоги и КП считает сервер. Если `sort_number` не задан, он равен индексу строки в `items`.
- **`ref` / `parent_ref`.** `ref` — произвольный непустой ключ строки, уникальный в пределах позиции. Материал
  привязывается к работе той же позиции через `parent_ref` = `ref` работы (`parent_work_item_id` в пакете **не
  принимается**). Работа родителя иметь не может; `parent_ref` указывает только на работу, не на себя.
  Порядок строк в `items` любой: сначала вставляются строки без `parent_ref`, затем с ним.
- **`replace: true`.** Перед вставкой удаляются строки этой позиции, записанные **этим же прогоном** (аудит `DELETE`
  по каждой). Ручные строки и строки других прогонов не трогаются. Если под заменяемой работой висит чужая
  дочерняя строка (ручная или другого прогона) — 409 `foreign_children`, ничего не меняется.
- **Подтверждённая позиция** (`approved`): любая запись в неё — `items`, `replace` или `review` — даёт 409 `approved`
  на весь запрос; сначала `reopen` в портале.
- **Лимиты.** Тело ≤ 8 МБ; позиций 1…50; строк (сумма по всем позициям) ≤ 2000.
- **Побочные эффекты.** Аудит `INSERT`/`DELETE` с автором — выпустившим ключ; счётчик строк прогона, итоги позиций
  (`total_material`, `total_works`) и одна ревизия финансовых входов тендера — за запрос, не за строку;
  пересчёт коммерции ставится в очередь один раз после коммита.

Ответ 200 (позиции и строки — в порядке запроса; `review` — `null`, если не передавалась):

```json
{"data":[
  {"position_id":"<uuid>",
   "items":[
     {"ref":"w1","id":"<uuid>","parent_work_item_id":null,"quantity":120,"unit_rate":850,"total_amount":102000,"updated_at":"2026-10-28T09:00:00Z"},
     {"ref":"m1","id":"<uuid>","parent_work_item_id":"<id работы w1>","quantity":14.5,"unit_rate":32,"total_amount":464,"updated_at":"2026-10-28T09:00:00Z"}
   ],
   "review":{"client_position_id":"<uuid>","status":"pending","basis":"ASSUMED", "…":"как в GET …/reviews"}}
]}
```

Ошибки. Тела прогона — `{"error":"<код>","message":"<по-русски>", …}`; отказы гейта ключа — RFC 7807 с `code`;
`MISSING_FX_RATE` — как у `POST …/items` (RFC 7807), плюс `position_id`/`ref`.

| Код | Когда | Тело (суть) |
|---|---|---|
| 400 | битый JSON; `positions` пуст; `sid` не UUID | `{"error":"bad_request","message":"Некорректный JSON."}` |
| 400 | не задан курс валюты тендера | `{"code":"MISSING_FX_RATE","currency":"USD","position_id":"…","ref":"m1",…}` |
| 403 | у ключа нет `tenders:write` | `{"code":"API_KEY_SCOPE_DENIED","requiredScope":"tenders:write",…}` |
| 403 | ключ не включает тендер прогона | `{"code":"API_KEY_TENDER_DENIED",…}` |
| 404 | прогона нет / позиция не из тендера прогона | `{"error":"run_not_found",…}` / `{"error":"position_not_found","position_id":"…",…}` |
| 409 | позиция подтверждена | `{"error":"approved","message":"Позиция подтверждена: сначала снимите подтверждение (переоткрыть).","position_id":"…"}` |
| 409 | прогон отменён; чужие дочерние строки при `replace` | `{"error":"run_cancelled",…}` / `{"error":"foreign_children","position_id":"…",…}` |
| 413 | тело > 8 МБ либо > 50 позиций или > 2000 строк | `{"error":"too_large","message":"не больше 50 позиций и 2000 строк на запрос: получено 51 позиций, 1830 строк"}` |
| 422 | ошибка в данных строки/позиции | см. ниже |

422 `invalid_item` — первая найденная ошибка; `field` — имя поля запроса (`review.<поле>` для карточки),
`ref` пуст, если ошибка на уровне позиции:

```json
{"error":"invalid_item","message":"parent_ref: строка с таким ref не найдена в этой позиции",
 "position_id":"<uuid>","ref":"m1","field":"parent_ref"}
```

Причины: пустой/повторный `position_id` или `ref`; `parent_ref` не найден, на себя, на материал, у работы;
`parent_work_item_id` в строке; `boq_item_type` вне списка; нарушены проверки полей (`unit_rate < 0`, не UUID и т. п.);
работа без `work_name_id` / материал без `material_name_id`; неверные даты источника (`quote_price_date`,
`quote_valid_until`); несуществующие `work_name_id`, `material_name_id`, `unit_code`, `detail_cost_category_id`
(`field` — по имени ограничения БД); невалидная карточка (`review.basis`, `review.findings`, …).

Идемпотентности нет: при сетевой ошибке без ответа повторите запрос с `replace: true`, иначе строки задвоятся.

## Наименования работ и материалов — область `nomenclature:write`

`POST /api/v1/nomenclature/ensure` — найти или создать имя в общем справочнике, чтобы
затем передать `work_name_id` / `material_name_id` в строку BOQ.

```json
{"items":[{"kind":"work","name":"Устройство стяжки","unit":"м2"},
          {"kind":"material","name":"Цемент М400","unit":"кг"}]}
```

- 1–500 элементов; `kind` — `work` | `material`; `name` непустое после trim, до 1024
  символов; `unit` — код существующей единицы. Ошибка → 400
  `NOMENCLATURE_INVALID_REQUEST` с `itemIndex`, ничего не записывается.
- Идемпотентно: поиск среди имён того же вида с той же единицей, без учёта регистра и с
  схлопнутыми пробелами. Найдено → его `id`, `created:false`; нет → вставка,
  `created:true`. Одна транзакция; одинаковые элементы запроса не дают двух вставок.
- Ответ 200: `{"data":[{"index":0,"id":"…","kind":"work","name":"как в БД","unit":"м2","created":true}]}`
  в порядке запроса. Ограничение ключа по тендерам не действует (справочник общий).

## Расценка по аналогу (пилот) — только JWT портала

Не для ключей API: маршруты в JWT-группе, права те же, что у штатной записи строк BOQ
(отдельного серверного гейта по ролям/дедлайну у неё нет). Ответы: `Cache-Control: no-store`,
успех `{"data": …}`, ошибка `{"error":"<КОД>","message":"<по-русски>", …}`. Строки аналога
пишутся в чёрновой прогон тендера (`import_sessions`: `source='autoprice'`,
`label='Аналоги из архива'`, `file_name='analog-pilot'`, создаётся при первом применении);
подтверждение — штатным `POST /autoprice-runs/{sid}/positions/{pid}/review/action`.

| Маршрут | Что делает |
|---|---|
| `GET /api/v1/positions/{id}/analogs?q=&limit=` | кандидаты из архива (по умолчанию 3, максимум 30, `has_more`); единица и объём цели — только в скоринг |
| `GET /api/v1/analogs/sources/{srcId}` | позиция-аналог целиком со строками и датами цен |
| `POST /api/v1/positions/{id}/analog:preview` | предпросмотр (транзакция с ROLLBACK), `preview_token` |
| `POST /api/v1/positions/{id}/analog:apply` | применение; тело = предпросмотр + `preview_token` + `idempotency_key` (uuid) |
| `GET /api/v1/positions/{id}/analog-applications` | последние 20 решений по позиции |
| `POST /api/v1/analog-applications/{id}/revert` | отмена решения (удаляет свои строки), идемпотентно |
| `GET /api/v1/positions/{id}/analog-next` | следующая позиция тендера без строк и с единицей, либо `null` |

Тело предпросмотра/применения: `{"source_position_id", "scale": {"mode": "none|volume_ratio|factor",
"factor"?}, "copy_prices": bool}` — `mode` и `copy_prices` обязательны, без умолчаний.
Коды ошибок: 400 `ANALOG_BAD_REQUEST`, `ANALOG_SCALE_NEEDS_DECISION` (разные единицы),
`ANALOG_VOLUME_UNKNOWN` (нет/ноль объёма), `ANALOG_SCALE_INVALID`, `ANALOG_SOURCE_EMPTY`,
`ANALOG_SOURCE_SAME_TENDER`, `MISSING_FX_RATE`; 404 `ANALOG_TARGET_NOT_FOUND`,
`ANALOG_SOURCE_NOT_FOUND`, `ANALOG_APPLICATION_NOT_FOUND`; 409 `ANALOG_STALE` (`changed`:
`source|target`), `ANALOG_TARGET_LOCKED`, `ANALOG_TARGET_HAS_ROWS`,
`ANALOG_IDEMPOTENCY_CONFLICT`, `ANALOG_FOREIGN_CHILDREN`, `ANALOG_NOT_ACTIVE`; 422
`INVALID_BOQ_PARENT`. Повтор `analog:apply` с тем же ключом и телом возвращает сохранённый
результат (`replayed: true`) без второго комплекта строк. Миграция:
`db/yandex/incremental/2026_10_analog_applications.sql`.

## Лимиты и поведение

- Лимит запросов — `rate_limit_per_minute` на ключ (по умолчанию 120, окно — минута);
  превышение → 429 без поля `code` и без заголовка `Retry-After`: подождите до начала
  следующей минуты.
- Ограничение ключа по тендерам: для маршрутов с `{id}` тендера в URL проверяется гейтом,
  для `/positions/{id}/…` и `/items/{id}` — по позиции/строке в базе, для
  `/tenders/brief` — фильтром выборки.
- Таймаут сервера — 5 мин на запрос; ответы с `ETag` поддерживают `If-None-Match` → 304.
- Каждый вызов по ключу пишется в журнал (метаданные, без тел).
