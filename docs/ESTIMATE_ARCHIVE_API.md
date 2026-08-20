# Архив смет — API

Машинный доступ к историческим сметам: поиск позиций заказчика по всем прошлым тендерам,
подбор аналогов и сборка новых позиций целевого тендера на их основе. UI нет — домен
рассчитан на вызовы из кода.

- Спецификация: [`backend/internal/handlers/openapi/archive.yaml`](../backend/internal/handlers/openapi/archive.yaml),
  она же отдаётся живым сервисом по `GET /api/v1/archive/openapi.yaml`.
  Клиент генерируется любым `openapi-generator` — это и заменяет автодоки FastAPI.
- Инварианты расчёта: [`CALCULATION_SOURCE_OF_TRUTH.md`](CALCULATION_SOURCE_OF_TRUTH.md), §7b-bis.
- Подключение из Cursor: [`ESTIMATE_ARCHIVE_CURSOR.md`](ESTIMATE_ARCHIVE_CURSOR.md).

## Почему не отдельный Python-сервис

Все инварианты расчёта (`total_amount`, коммерческие колонки, `cached_grand_total`,
финансовые ревизии, audit-триггер) реализованы в Go BFF. Писать в БД мимо них — гарантированный
рассинхрон тендера. Плюс прод не использует docker-compose (Go BFF под systemd, образ собирается
на самом проде, реестра образов нет), а ингресс-nginx лежит вне репозитория. Отдельный рантайм
дал бы только автодокументацию — её закрывает OpenAPI-спека.

## Авторизация

Два способа. Для внешнего кода — **ключ**, для человека в браузере — обычный JWT портала.

### Ключ (машинный доступ)

Выпускается в UI: **Настройки → Доступ к API → Ключи → Выпустить ключ**. Секрет
показывается один раз; в БД лежит только его SHA-256 хеш, восстановить нельзя.

```bash
curl -s "$BASE/api/v1/archive/positions/search?q=стяжка" -H "X-API-Key: thk_..."
```

Ключ действует **от имени выпустившего пользователя** — правки в сметах подписываются им
(аудит `boq_items_audit.changed_by` ссылается на реального пользователя, анонимной записи
быть не может). Ограничения ключа:

| Ограничение | Поведение при нарушении |
|---|---|
| Область `archive:read` — поиск, подбор, чтение позиции | 403 |
| Область `archive:write` — `compose` | 403 |
| Список разрешённых тендеров (пусто = все) | 403 при чужом тендере |
| Срок действия, отзыв | 401 (просроченный и отозванный не находятся вовсе) |
| Лимит запросов в минуту | 429 |

### JWT (человек)

```bash
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login"   -H 'Content-Type: application/json'   -d '{"email":"service@example.com","password":"..."}' | jq -r .access_token)

curl -s "$BASE/api/v1/archive/positions/search?q=..." -H "Authorization: Bearer $TOKEN"
```

Заголовок `X-API-Key` имеет приоритет: если он есть, JWT не рассматривается — смешивать
двух принципалов в одном запросе нельзя, иначе непонятно, чьи ограничения применять.
К JWT области не применяются: у человека прав ровно столько, сколько даёт роль и список
страниц. Per-tender ACL для JWT в BFF по-прежнему нет — авторизованный пользователь видит
позиции любого тендера.

## Управление доступом (UI)

Страница **Настройки → Доступ к API** (`/admin/api-access`), доступна ролям
`administrator` и `developer` — гейт серверный (`RequireRoles` на `/api/v1/admin/api-access/*`),
а не только пункт меню.

Три вкладки:

- **Ключи** — выпуск, отзыв, удаление. Видно префикс, права, срок, число вызовов за сутки
  и кто выпустил. Отзыв действует немедленно.
- **Выдача API** — тумблеры каждого эндпоинта (выключенный отвечает 503) и потолки:
  максимум строк в выдаче, кандидатов префильтра, запросов в батче, запросов в минуту на
  ключ, срок хранения журнала. Тумблеры применяются и к вызовам по JWT: это кнопка
  экстренной остановки домена, кэш настроек живёт 10 секунд.
- **Журнал вызовов** — время, источник (ключ или браузер), запрос, статус, код ошибки,
  число затронутых строк, признак `dry_run`, длительность. Только метаданные: ни тел
  запросов, ни секретов. Чистится по сроку хранения.

Админские эндпоинты: `GET|POST /api/v1/admin/api-access/keys`,
`POST /api/v1/admin/api-access/keys/{id}/revoke`, `DELETE .../keys/{id}`,
`GET|PUT .../settings`, `GET .../calls`.

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/archive/positions/search` | поиск похожих исторических позиций |
| POST | `/api/v1/archive/positions/suggest` | батч-подбор аналогов (до 100 запросов) |
| GET | `/api/v1/archive/positions/{id}` | историческая позиция + тендер + строки BOQ |
| POST | `/api/v1/archive/compose` | сборка позиций целевого тендера из исторических |
| GET | `/api/v1/archive/openapi.yaml` | спецификация |

### Как считается похожесть

Двухступенчато: грубый SQL-префильтр по значащим токенам названия (`ILIKE`), затем взвешенная
оценка в Go — название 50, `item_no` 30, единица 10, объём 10, нормировка **только по применимым**
компонентам (отсутствие `item_no` в запросе не топит кандидата). Близость названия считается
token-overlap'ом со significant-token'ами из `internal/ai/nomenclature`: «Бетон М150» против
«Бетон М200» — конфликт марки со штрафом, а не «почти совпало».

## Типовой сценарий: найти аналог → dry_run → запись

### 1. Найти похожие позиции в архиве

```bash
curl -sG "$BASE/api/v1/archive/positions/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'q=Устройство цементно-песчаной стяжки' \
  --data-urlencode 'unit_code=м2' \
  --data-urlencode 'volume=1200' \
  --data-urlencode "exclude_tender_id=$TARGET_TENDER" \
  --data-urlencode 'limit=10'
```

Каждое попадание несёт `score`, `score_breakdown`, контекст тендера (номер, версия, клиент,
дата, признак согласования) и удельные стоимости позиции — по ним видно, какая история
релевантна.

### 2. Посмотреть состав понравившейся позиции

```bash
curl -s "$BASE/api/v1/archive/positions/$SRC_POSITION" -H "Authorization: Bearer $TOKEN"
```

Вернутся позиция, тендер-источник (включая его курсы — как справка) и все строки BOQ.

### 3. Прогнать сборку вхолостую

```bash
curl -s -X POST "$BASE/api/v1/archive/compose?verbose=1" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @- <<JSON
{
  "target_tender_id": "$TARGET_TENDER",
  "dry_run": true,
  "groups": [{
    "temp_id": "g1",
    "target": {
      "new_position": {
        "work_name": "Устройство стяжки",
        "unit_code": "м2",
        "volume": 1200,
        "manual_volume": 1200
      }
    },
    "sources": [{
      "source_position_id": "$SRC_POSITION",
      "scale": { "mode": "volume_ratio" }
    }]
  }]
}
JSON
```

`dry_run` выполняет ту же самую транзакцию и откатывает её. Значит:

- срабатывают все CHECK-констрейнты и валидации — ответ честный, а не «прикидка»;
- суммы (`total_amount`, `total_material`, `cached_grand_total`) настоящие, посчитанные
  по конфигурации и курсам **целевого** тендера;
- в БД не остаётся ничего, realtime-события не рассылаются, аудит не пишется;
- id новых строк не отдаются — вместо них `index` / `parent_index`.

Стоит смотреть `warnings`: `LINKED_QUANTITY_REDERIVED` означает, что у исторической строки
количество привязанного материала было рассогласовано с формулой, и в цель уехало
пере-выведенное значение.

### 4. Записать

Тот же запрос с `"dry_run": false`. Проверить после записи:

```bash
curl -s "$BASE/api/v1/tenders/$TARGET_TENDER/overview" -H "Authorization: Bearer $TOKEN"
```

`cached_grand_total` должен совпасть с ответом сборки, `financial_calculation_status` —
`calculated`, а `financial_calculation_revision` — равняться `financial_input_revision`.

## Что нужно знать перед записью

- **Одна группа = одна целевая позиция.** Это требование БД: FK `boq_items_parent_scope_fkey`
  не даёт связи материал → работа пересекать позицию. Слить N исторических позиций в одну
  целевую можно — перечислите их в `sources`.
- **Валюта не конвертируется.** `unit_rate` и `currency_type` переносятся как есть, курс
  применяется целевой. Если у целевого тендера нет нужного курса — 400 `MISSING_FX_RATE`
  и полный откат. Это защита, а не ошибка: иначе строка ушла бы в базу с нулевой суммой.
- **Производные значения не копируются никогда.** `total_amount` и коммерческие стоимости
  считает сервер внутри той же транзакции.
- **Масштабирование.** Работы и самостоятельные материалы умножаются на `k`. Материал,
  привязанный к работе, пере-выводится из масштабированного родителя
  (`parentQty × conversion × consumption`) — так результат идемпотентен относительно
  штатного `recompute-linked-materials`.
- **Идемпотентности нет.** Повторный POST соберёт всё второй раз. Защита — `dry_run`
  плюс контроль на стороне вызывающего кода.
- **Частичной сборки не бывает.** Любая 4xx откатывает транзакцию целиком.

## Коды ошибок

| Код | Статус | Когда |
|---|---|---|
| `ARCHIVE_TARGET_SPEC_INVALID` | 400 | цель группы задана неверно (ни одного или оба ключа) |
| `ARCHIVE_NOTHING_TO_COMPOSE` | 400 | после фильтрации копировать нечего |
| `ARCHIVE_SCALE_UNDEFINED` | 400 | `volume_ratio` без объёма источника или цели |
| `ARCHIVE_SCALE_INVALID` | 400 | недопустимый `factor` или неизвестный режим |
| `ARCHIVE_QUANTITY_UNDERFLOW` | 400 | после масштабирования количество стало нулевым |
| `INVALID_BOQ_PARENT` | 400 | `source_item_ids` исключил родительскую работу |
| `MISSING_FX_RATE` | 400 | у целевого тендера нет курса скопированной валюты |
| `ARCHIVE_TARGET_POSITION_NOT_FOUND` | 404 | целевой позиции нет |
| `ARCHIVE_SOURCE_POSITION_NOT_FOUND` | 404 | позиции-источника нет (или `on_missing_source: "skip"`) |
| `ARCHIVE_SOURCE_ITEM_NOT_FOUND` | 404 | в `source_item_ids` строка чужой позиции |
| `ARCHIVE_DUPLICATE_TARGET` | 409 | один `temp_id` или одна целевая позиция дважды |
| `ARCHIVE_TARGET_TENDER_MISMATCH` | 409 | целевая позиция принадлежит другому тендеру |
| `ARCHIVE_CONCURRENT_MODIFICATION` | 409 | тендер изменили параллельно, сборка отменена |
| `API_KEY_SCOPE_DENIED` | 403 | ключу не выдана нужная область |
| `API_KEY_TENDER_DENIED` | 403 | тендер вне списка, разрешённого ключу |
| `ENDPOINT_DISABLED` | 503 | эндпоинт выключен в «Настройки → Доступ к API» |
| — | 429 | превышен лимит запросов в минуту для ключа |

## Производительность поиска

Префильтр использует `ILIKE '%токен%'` — индекса под это нет. Схема в `db/yandex/sql/`
принципиально не содержит `CREATE EXTENSION` (расширения включаются в консоли Yandex MDB),
поэтому `pg_trgm` в первой версии не вводится. Ограничители: `candidate_limit` (по умолчанию
500, максимум 4000), `only_latest_version` (одна версия на `tender_number`), `period_months`,
`with_boq_only`. Если поиск станет узким местом — включить `pg_trgm` в консоли, добавить
GIN-индекс `client_positions USING gin (work_name gin_trgm_ops)` и заменить `ILIKE ANY` на
`%` / `similarity()`: точка подмены изолирована в `LoadCandidates`
(`backend/internal/repository/archive_search.go`).

## Код

| Слой | Файлы |
|---|---|
| Скоринг (pure) | `backend/internal/analytics/estimatearchive/` |
| Репозиторий | `backend/internal/repository/archive_search.go`, `archive_read.go`, `archive_compose*.go` |
| Сервис | `backend/internal/services/archive.go` |
| Хендлеры | `backend/internal/handlers/archive_search.go`, `archive.go`, `archive_openapi.go` |
| Ошибки | `backend/pkg/apierr/archive.go` |
| Ключи, настройки, журнал | `backend/internal/apikey/`, `backend/internal/repository/api_access*.go`, `backend/internal/services/api_access.go`, `backend/internal/handlers/api_access.go`, `backend/internal/middleware/apikey.go` |
| UI управления доступом | `src/pages/AdminApiAccess/`, `src/lib/api/apiAccess.ts` |
| CLI и правило для Cursor | `scripts/archive-api.mjs`, `.cursor/rules/estimate-archive-api.mdc` |
| Схема | `db/yandex/incremental/2026_08_api_access_control.sql` |
| Маршруты | `backend/cmd/server/routes.go` |
