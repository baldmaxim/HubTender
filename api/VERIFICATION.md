# TenderHUB — «Проверка данных» по API-ключу

Как дать ИИ-помощнику (Cursor, Codex, Claude Code, свой скрипт) читать находки
проверки расчёта, готовность разделов, сравнение с эталонами и выжимку — и ставить
вердикты за проверяющего. Общие шаги (выпуск ключа, переменные окружения, заголовок
`X-API-Key`, ошибки) — в [README.md](README.md); здесь только то, что относится к
проверке.

## Права ключа

**Настройки → Доступ к API → Выпустить ключ**, отметить:

| Право | Область | Что открывает |
|---|---|---|
| Чтение тендеров и смет | `tenders:read` | смета целиком: позиции, строки, цены, КП — без неё находки не с чем сверять |
| Чтение проверки данных | `verification:read` | находки правил, каталог правил, разделы ВОР, эталоны, выжимка |
| Действия проверяющего | `verification:write` | вердикты, «Проверка завершена», отметки разделов, текст выжимки |

Для анализа достаточно первых двух. `verification:write` выдавайте, только если помощник
должен сам отмечать находки: вердикт пишется **от имени владельца ключа** и на
странице неотличим от поставленного вручную (в истории находки — источник `api`).

Ограничение ключа списком тендеров действует на все адреса ниже.

По ключу **не** открываются: рассылка замечаний в Telegram, правка справочника
эталонов, выгрузка вердиктов по всей базе (`/quality/export`).

## Эндпоинты

Все пути относительно base URL, ответы в конверте `{"data": …}`.

### Чтение — `verification:read`

| Метод и путь | Что отдаёт |
|---|---|
| `GET /api/v1/tenders/{id}/quality` | находки правил по тендеру (см. ниже) |
| `GET /api/v1/quality/rules` | каталог правил: `Code`, `Title`, `Severity`, `Status`, `EntityType`, `Summary` (суть правила), `SQL` |
| `GET /api/v1/tenders/{id}/verification/sections` | разделы ВОР: позиций, расценено, без Кол-ва ГП, без обоснования, открытые ошибки, отметка «проверено» и что изменилось после неё |
| `GET /api/v1/tenders/{id}/cost-benchmarks?period_months=24` | ₽ за единицу объёма и ₽/м² СП по категориям против эталона (справочник или история по классу жилья) |
| `GET /api/v1/benchmark-ranges` | справочник ручных диапазонов эталонов |
| `GET /api/v1/tenders/{id}/brief` | выжимка для руководства: текст и выбранные категории |

**Параметры `/quality`:**

| Параметр | Смысл |
|---|---|
| `only_new=1` | только находки, появившиеся после последней отметки «Проверка завершена» — инкрементальная проверка |
| `open_only=1` | без принятых как норма |
| `rule=U,V` | только перечисленные правила |
| `refresh=1` | прогнать правила заново, минуя кэш (до ~10 с на крупном тендере) |

**Поля находки:** `rule_code`, `rule_title`, `severity` (`error`/`warning`/`info`),
`summary`, `position_number`, `item_no`, `entity_type` (`boq_item` — строка сметы,
`client_position` — позиция), `entity_id`, `fingerprint`, `detail` (что не так, с
числами), `money_delta`, `verdict` (`accepted`/`error`/`null`), `note`, `finding_id`,
`first_seen_at`, `is_new`. Поле `summary` одинаково у всех находок правила — для
экономии контекста берите его из `/quality/rules`.

### Действия — `verification:write`

| Метод и путь | Тело |
|---|---|
| `POST /api/v1/tenders/{id}/quality/verdict` | `{rule_code, entity_id, fingerprint, verdict: "accepted"\|"error", note?}` |
| `POST /api/v1/tenders/{id}/quality/verdicts` | `{items: [ …как выше… ]}`, до 5000 за раз |
| `POST /api/v1/tenders/{id}/quality/checkpoint` | без тела — «Проверка завершена» |
| `POST /api/v1/tenders/{id}/verification/sections/mark` | `{section_key, stage: "review", content_hash, note?}` — `content_hash` из `/sections`; раздел изменился → `409 SECTION_CHANGED` |
| `POST /api/v1/tenders/{id}/verification/sections/unmark` | `{section_key, stage: "review"}` |
| `PUT /api/v1/tenders/{id}/brief` | `{summary_text, fact_category_ids}` — `fact_category_ids: null` = крупнейшие категории автоматически |

Вердикт привязан к `fingerprint`: изменились данные строки — вердикт перестаёт
действовать, находка снова открыта. Берите `fingerprint` из свежего ответа `/quality`.

`checkpoint` сдвигает точку «новизны» и для людей на странице — вызывать, только когда
проверка действительно пройдена.

## Сценарий: проверить тендер

```bash
# 1. найти тендер
node scripts/archive-api.mjs tenders --search="Большая Татарская"

# 2. что правила считают ошибками (только новое и непринятое)
node scripts/archive-api.mjs quality <tender_id> --new --open
node scripts/archive-api.mjs rules                         # что значит каждый код

# 3. готовность разделов и цены против эталонов
node scripts/archive-api.mjs sections <tender_id>
node scripts/archive-api.mjs benchmarks <tender_id>

# 4. сверить подозрительное со сметой
node scripts/archive-api.mjs estimate <tender_id> --position=<position_id>

# 5. (verification:write) отметить разобранное и закрыть проверку
node scripts/archive-api.mjs verdicts <tender_id> ./verdicts.json
node scripts/archive-api.mjs checkpoint <tender_id>

# 6. (verification:write) записать выжимку для руководства
node scripts/archive-api.mjs brief-set <tender_id> ./brief.txt
```

Команда `quality` по умолчанию печатает компактные находки без `summary`; `--full` —
ответ целиком.

## Ошибки

| Ответ | Причина |
|---|---|
| `403 API_KEY_SCOPE_DENIED`, `requiredScope: verification:read` | ключу не выдано право «Чтение проверки данных» — выпустить новый ключ |
| `403 API_KEY_TENDER_DENIED` | тендер не входит в список разрешённых для ключа |
| `409 SECTION_CHANGED` | раздел изменили после чтения `/sections` — перечитать и повторить |
| `401 invalid or expired token` | ключ послан как `Authorization: Bearer` вместо `X-API-Key` |
