# Подключение ИИ-помощников

Общее для всех: ключ выпущен ([README.md](README.md), шаг 1), лежит в переменных
окружения `TENDERHUB_API_KEY` и `TENDERHUB_API_URL` (шаг 2), связь проверена (шаг 3).
Помощнику нужны две вещи: **инструкция** ([AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md))
и **способ вызывать API** — CLI [`scripts/archive-api.mjs`](../scripts/archive-api.mjs)
(нужен Node 18+) либо прямой HTTP.

Если помощник работает не в этом репозитории, скопируйте к себе
`scripts/archive-api.mjs` (один файл без зависимостей) и `api/AGENT_INSTRUCTIONS.md`.

## Cursor

1. Ключ в окружение через `setx` (Windows) или `~/.bashrc`; **перезапустить Cursor** —
   открытые окна старое окружение не подхватывают.
2. Правило проекта уже лежит в
   [`.cursor/rules/estimate-archive-api.mdc`](../.cursor/rules/estimate-archive-api.mdc):
   команды CLI, порядок работы, разбор ошибок. В нём `alwaysApply: false` — Cursor
   подключает его по описанию, когда запрос про тендеры/сметы/архив. Чтобы правило
   действовало всегда, поставьте `alwaysApply: true`.
3. В другом проекте: создать `.cursor/rules/tenderhub-api.mdc` с frontmatter
   ```
   ---
   description: Доступ к тендерам и сметам TenderHUB по API-ключу
   alwaysApply: false
   ---
   ```
   и содержимым [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md).
4. Проверка: спросить агента «покажи смету тендера ЖК Север по разделу монолит» — он
   должен вызвать `node scripts/archive-api.mjs tenders --search=…`, затем
   `positions … --section=монолит` / `estimate …`.

MCP-мост поверх OpenAPI (`node scripts/archive-api.mjs spec > tenderhub-openapi.yaml` +
`.cursor/mcp.json` с `"TENDERHUB_API_KEY": "${env:TENDERHUB_API_KEY}"`) возможен, но
конкретный пакет-мост не проверялся; ключ в `mcp.json` не вписывать.

## Codex (OpenAI)

**Codex CLI / IDE-расширение** (локально):

1. Ключ в окружение той оболочки, из которой запускается Codex (`setx` / `~/.bashrc`).
2. В корень проекта положить `AGENTS.md` с содержимым
   [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) (Codex читает `AGENTS.md` из корня
   репозитория и родительских каталогов; для всех проектов — `~/.codex/AGENTS.md`).
3. Codex выполняет команды в песочнице: при первом сетевом вызове подтвердите доступ к
   `tender.su10.ru` либо запустите с разрешённой сетью для этой команды.

**Codex Cloud** (задачи в облаке):

1. В настройках окружения задачи добавить секрет `TENDERHUB_API_KEY` и переменную
   `TENDERHUB_API_URL=https://tender.su10.ru`.
2. Включить сетевой доступ в фазе выполнения агента (по умолчанию он выключен) и
   ограничить его хостом `tender.su10.ru`.
3. `AGENTS.md` — как выше.

## Claude Code

1. Ключ в окружение оболочки.
2. Инструкция — либо в `CLAUDE.md` проекта (вставить
   [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) или ссылку на него), либо как
   skill/команда в `.claude/`.
3. Проверка: «сколько позиций в тендере <номер> и какая сумма КП?» — агент должен
   вызвать `tenders` и `tender`.

## Любой другой клиент (curl, Python, генератор клиентов)

```bash
BASE=https://tender.su10.ru
H="X-API-Key: $TENDERHUB_API_KEY"

curl -s --compressed -H "$H" "$BASE/api/v1/tenders/brief?search=Север"
curl -s --compressed -H "$H" "$BASE/api/v1/tenders/<id>/overview"
curl -s --compressed -H "$H" "$BASE/api/v1/tenders/<id>/positions/with-costs"
curl -s --compressed -H "$H" "$BASE/api/v1/tenders/<id>/boq-items-full"
```

```python
import os, requests
s = requests.Session()
s.headers["X-API-Key"] = os.environ["TENDERHUB_API_KEY"]
base = os.environ.get("TENDERHUB_API_URL", "https://tender.su10.ru")
tenders = s.get(f"{base}/api/v1/tenders/brief", params={"search": "Север"}).json()["data"]
rows = s.get(f"{base}/api/v1/tenders/{tenders[0]['id']}/boq-items-full").json()["data"]
```

Клиент на любом языке генерируется из спецификации:
`curl -s $BASE/api/v1/archive/openapi.yaml > tenderhub-openapi.yaml` → `openapi-generator`.

## Типовые проблемы

| Симптом | Причина |
|---|---|
| `Не задан TENDERHUB_API_KEY` | переменная не подхватилась — перезапустить терминал/редактор |
| `Не удалось соединиться` | неверный `TENDERHUB_API_URL`, нет сети, песочница агента без сети |
| `HTTP 401` | ключ отозван/просрочен/скопирован с ошибкой |
| `HTTP 403 [API_KEY_SCOPE_DENIED]` | ключу не выдано право «Чтение тендеров и смет» |
| `HTTP 403 [API_KEY_TENDER_DENIED]` | тендер вне списка разрешённых для ключа |
| пустой `data` в `tenders` | ключ ограничен тендерами, которых нет/архивированы; проверить фильтр `--archived` |
| очень долгий `estimate` | крупный тендер — брать по позициям (`--position`) |
