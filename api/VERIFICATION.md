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

По ключу **не** открываются: постановка рассылки замечаний в очередь (кнопка
«Отправить исполнителям» — только из интерфейса, под пользователем), правка справочника
эталонов, выгрузка вердиктов по всей базе (`/quality/export`). Доставку рассылки делает
внешний Telegram-бот по отдельной области `verification:telegram` —
см. [VERIFICATION_BOT.md](VERIFICATION_BOT.md).

## Эндпоинты

Все пути относительно base URL, ответы в конверте `{"data": …}`.

### Чтение — `verification:read`

| Метод и путь | Что отдаёт |
|---|---|
| `GET /api/v1/tenders/{id}/quality` | находки правил по тендеру (см. ниже) |
| `GET /api/v1/quality/rules` | каталог правил: `Code`, `Title`, `Severity`, `Status`, `EntityType`, `Money` (считает ли правило денежный эффект), `Summary` (суть правила), `SQL` |
| `GET /api/v1/tenders/{id}/verification/sections` | разделы ВОР: позиций, расценено, без Кол-ва ГП, без обоснования, открытые ошибки, отметка «проверено» и что изменилось после неё |
| `GET /api/v1/tenders/{id}/cost-benchmarks?period_months=24` | ₽ за единицу объёма и ₽/м² СП по категориям против эталона (справочник или история по классу жилья). `period_months` — только 6, 12, 24 или 36, иначе 400 |
| `GET /api/v1/benchmark-ranges` | справочник ручных диапазонов эталонов |
| `GET /api/v1/tenders/{id}/brief` | выжимка для руководства: текст и выбранные категории |
| `GET /api/v1/tenders/{id}/verification/ai-assessments` | ИИ-оценки открытых находок: `finding_id`, `label` (`likely_error`/`likely_ok`/`unsure`), `reason`, `evidence` (подтверждённые ссылки на поля), `current` (данные с оценки не менялись); `availability` — можно ли запустить разбор, `running` — идёт ли разбор сейчас |

**Параметры `/quality`:**

| Параметр | Смысл |
|---|---|
| `only_new=1` | только находки, появившиеся после последней отметки «Проверка завершена» — инкрементальная проверка |
| `open_only=1` | без принятых как норма |
| `rule=U,V` | только перечисленные правила |
| `refresh=1` | прогнать правила заново, минуя кэш (до ~10 с на крупном тендере) |

**Поля находки:** `rule_code`, `rule_title`, `severity` (`error`/`warning`/`info`),
`summary`, `position_number`, `item_no`, `entity_type` (`boq_item` — строка сметы,
`client_position` — позиция, `material_name` — наименование материала, `tender` —
тендер целиком), `entity_id`, `position_id` (позиция заказчика, к которой ведёт ссылка
«к строке»: для находки по позиции — она сама, по строке — позиция строки; `null` — у
находки нет позиции), `fingerprint`, `detail` (что не так, с
числами), `money_delta`, `verdict` (`accepted`/`error`/`null`), `note`, `finding_id`,
`first_seen_at`, `is_new`. Поле `summary` одинаково у всех находок правила — для
экономии контекста берите его из `/quality/rules`.

### Действия — `verification:write`

| Метод и путь | Тело | Ответ |
|---|---|---|
| `POST /api/v1/tenders/{id}/quality/verdict` | `{rule_code, entity_id, fingerprint, verdict: "accepted"\|"error", note?}` | 204 без тела |
| `POST /api/v1/tenders/{id}/quality/verdicts` | `{items: [ …как выше… ]}`, до 5000 за раз | 204 без тела |
| `POST /api/v1/tenders/{id}/quality/checkpoint` | без тела — «Проверка завершена» | 200 и полный отчёт, как у `/quality` |
| `POST /api/v1/tenders/{id}/verification/sections/mark` | `{section_key, stage: "review", content_hash, note?}` — `content_hash` из `/sections` | 204 без тела; раздел изменился → `409 SECTION_CHANGED`; раздела нет → 404 |
| `POST /api/v1/tenders/{id}/verification/sections/unmark` | `{section_key, stage: "review"}` | 204 без тела |
| `POST /api/v1/tenders/{id}/verification/ai-triage` | без тела — разобрать новые находки ИИ в фоне | `{status}`: 202 при `started`; 200 при `already_running`, `disabled`, `tender_not_in_pilot`, `not_configured` |
| `POST /api/v1/tenders/{id}/verification/ai-assessments` | оценки находок от внешнего скрипта, см. ниже | `{"data": {saved, skipped}}` |
| `PUT /api/v1/tenders/{id}/brief` | `{summary_text, fact_category_ids}` — `fact_category_ids: null` = крупнейшие категории автоматически; `summary_text` до 20 000 символов | 200 и сохранённая выжимка |

Ответы 204 приходят **без тела** — не разбирайте их как JSON.

Вердикт привязан к `fingerprint`: изменились данные строки — вердикт перестаёт
действовать, находка снова открыта. Берите `fingerprint` из свежего ответа `/quality`.

`checkpoint` сдвигает точку «новизны» и для людей на странице — вызывать, только когда
проверка действительно пройдена.

### Внешние ИИ-оценки — `POST …/verification/ai-assessments`

Скрипт на офисном ПК присылает свои оценки находок (`scripts/ai-review`); они ложатся в
те же ИИ-оценки, что и серверный разбор, и показываются на странице «Проверка данных».

```json
{
  "model_id": "qwen-27b",
  "prompt_version": "ext:review-v3",
  "items": [
    {"finding_id": "<uuid>", "fingerprint": "<из /quality>", "label": "likely_error",
     "reason": "…", "evidence": [{"ref": "r1.quantity", "value": "10"}]}
  ]
}
```

- `items` — от 1 до 2000; `label` — `likely_error`, `likely_ok` или `unsure`; `finding_id` —
  uuid; `fingerprint` обязателен.
- `prompt_version` обязана начинаться с `ext:` (не длиннее 100 символов), `model_id` —
  непустая, до 200 символов. Иначе `400`; `400` и на битый JSON, и на плохой элемент.
- `reason` обрезается до 2000 символов, `evidence` — до 10 фактов (нет поля — `[]`).
  Факты сервер не сверяет с данными: оценка пишется как есть, без «понижения» до `unsure`.
- Сервер берёт находки этого тендера и **пропускает** (`skipped`): находку чужого тендера
  или несуществующую, закрытую (её уже нет в открытых), и оценку с отпечатком, не
  совпавшим с текущим (данные изменились после чтения `/quality`). Остальные
  записываются (`saved`): одна текущая оценка на находку, новая заменяет прежнюю.
  Если находка повторяется в пакете, берётся последняя оценка.
- В `ai-assessments` (GET) оценка с `prompt_version` `ext:*` считается актуальной
  (`current: true`), пока совпадает отпечаток; версия серверного промпта не сверяется.
- Серверный ИИ-разбор параллельно включать нельзя: он перезаписывает оценку находки
  (одна оценка на находку), и внешние оценки пропадут.

## Событие «проверка обновилась»

Страница «Проверка данных» перечитывает данные по realtime-событию. Тема —
`verification:<tender_id>` (не `tender:<id>`: на неё подписаны тяжёлые страницы),
payload — `{"table": "verification", "op": "UPDATE", "id": "<tender_id>", "tender_id": "<tender_id>"}`.
Событие шлётся один раз на запрос:

- после `POST …/verification/ai-assessments`, если записана хотя бы одна оценка;
- после `POST …/quality/verdict` и `…/quality/verdicts`, **только** если запрос пришёл по
  API-ключу: вердикты человека со страницы событие не шлют.

Ошибка отправки события только пишется в лог и ответ запроса не меняет.

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
| `404` на `sections/mark` | раздела с таким `section_key` нет — структура ВОР изменилась, перечитать `/sections` |
| `400` на `cost-benchmarks` | `period_months` не из набора 6, 12, 24, 36 |
| `401 invalid or expired token` | ключ послан как `Authorization: Bearer` вместо `X-API-Key` |
