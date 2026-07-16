# OpenRouter Integration & AI Administration (этап 2.5, MVP)

Подключение OpenRouter к безопасной AI-границе этапа 2.2
(`NomenclatureReranker`, [AI_NOMENCLATURE_MATCHING.md](AI_NOMENCLATURE_MATCHING.md))
и административная страница **Администрирование → AI и нейросети**
(`/admin/ai-settings`).

Ключевой инвариант этапа: **normal-user live AI остаётся выключенным**
(rollout = off). Единственный разрешённый live-вызов OpenRouter — админский
синтетический тест модели. Пользовательский Smart Import продолжает работать
на deterministic retrieval + aliases + ручном выборе.

## 1. Продуктовая цель

Администратор без правки кода: видит, настроен ли ключ; проверяет
подключение; выбирает модель из живого каталога OpenRouter (цены, контекст,
модальности — от OpenRouter, не руками); прогоняет синтетический тест;
активирует конфигурацию. Всё это — подготовка к контролируемому запуску
(этап 2.6), не включение AI для пользователей.

## 2. OPENROUTER_API_KEY (server secret)

- `OPENROUTER_API_KEY` — только server env. Не в БД, не во frontend, не в
  логах/panic/metrics/Review Pack/доках/фикстурах. Admin API отдаёт только
  `api_key_configured: true|false`.
- Приложение обязано стартовать без ключа: статус `not_configured`, admin
  UI работает, каталог не грузится, deterministic/manual Smart Import
  работает, effective provider — `DisabledProvider`.
- Прочие server-only переменные: `OPENROUTER_API_BASE` (только allowlist
  официальных base URL в production; кастомный base разрешён вне production
  исключительно для fake-server-тестов), `OPENROUTER_HTTP_REFERER`,
  `OPENROUTER_APP_TITLE`, `OPENROUTER_TIMEOUT_SECONDS` (default 60).
- В UI нет поля ввода ключа и endpoint: «Ключ задаётся как server secret
  OPENROUTER_API_KEY».

## 3. Почему key не в БД

Ключ — операционный секрет с ротацией на стороне владельца; БД реплицируется,
бэкапится и читается большим числом ролей. Хранение в env изолирует секрет от
дампов/бэкапов/Review Pack и делает ротацию перезапуском контейнера. Таблица
настроек (`ai_feature_settings`) хранит только конфигурацию.

## 4. Connection status

`GET /api/v1/admin/ai/openrouter/status` — кэш ≤5 мин + `checked_at`;
`POST /api/v1/admin/ai/openrouter/test-connection` — всегда свежий запрос
`GET /key`. Состояния: `connected | not_configured | unauthorized |
payment_required | rate_limited | unavailable`.

## 5. Key usage/limits

Из официального `GET /key`: label, `limit`, `limit_remaining`, `limit_reset`,
`usage` (total/daily/weekly/monthly), BYOK-usage, `is_free_tier`,
`expires_at`. Сам ключ и management-поля не возвращаются.

## 6. Каталог моделей: GET /models/user

Каталог берётся с **`GET /api/v1/models/user`** (модели, доступные текущему
ключу и его policies), а не с глобального `/models`. Pagination official
(`offset`/`limit`, `links.next`, `total_count`) — вычитываются все страницы.

## 7. Catalog cache

Server-side in-memory, TTL 15 минут, singleflight-дедупликация конкурентных
обновлений, manual refresh (`POST …/models/refresh`), `fetched_at` /
`expires_at` / статус `fresh|stale|unavailable` / safe-код последней ошибки.
Каталог в PostgreSQL не сохраняется; после рестарта кэш пуст — это норма.
OpenRouter недоступен: есть кэш → `stale` (с временем снимка); кэша нет →
`unavailable`, выбор новой модели закрыт, snapshot выбранной модели из
настроек остаётся видимым.

## 8. Метаданные модели

Нормализованная модель: `id`, `canonical_slug`, `name`, `description`,
`created_at`, `expiration_date`, `context_length`, `max_completion_tokens`,
модальности, `tokenizer`, строковые decimal-цены (`prompt`/`completion`/
`request`) + server-calculated `price_per_1m_input_tokens` /
`price_per_1m_output_tokens` (точная арифметика `math/big.Rat`, без binary
float), `supported_parameters`, `is_moderated`, catalog-признак structured
outputs, free-вариант, автор. Эти цены display-only — в финансовые расчёты
тендера они не попадают.

## 9. Выбор модели

Только строка server-returned каталога (radio в таблице). Free-text ввода
model ID нет. Фильтры: поиск, организация, min context, max цена входа/выхода
/1M, structured-output индикация, статус теста, «выбранная». Free-варианты
показываются с пометкой «Не рекомендуется для production pilot».

## 10. Почему exact model ID

Расплывчатые alias'ы (`latest`, auto-роутеры) меняют фактическую модель без
ведома владельца — это ломает воспроизводимость теста и config hash. Пилот
привязывается к точному ID; смена модели — явное действие с повторным тестом.

## 11. Почему auto/free router не используются

`openrouter/auto` и подобные — динамическая маршрутизация на «какую-то»
модель: невозможно гарантировать privacy-policy маршрута и валидность
пройденного теста. Роутеры вычищаются из каталога по metadata (author
`openrouter` + отрицательные динамические цены), а не по хрупкому regex.

## 12. Safe provider policy (2.5, зафиксировано)

`data_collection = deny`, `zdr = true`, `require_parameters = true`,
`allow_fallbacks = false`, tools/external fetch — отсутствуют. Политики
отображаются в UI, но не ослабляются через него. Модель, не работающая с
этой политикой, проваливает тест и не активируется — политика под модель не
ослабляется. Изменение политики — отдельное owner decision вне 2.5.

## 13. Structured output

`response_format = {type: "json_schema", json_schema: {name, strict: true,
schema}}`, `additionalProperties: false` на всех уровнях; схема 1:1 с
domain-выходом этапа 2.2. Никаких markdown-парсеров, regex-extraction,
response-healing, tools, streaming. OpenRouter-enforcement не единственная
линия: после ответа выполняется локальная validation этапа 2.2
(`ValidateRowResult`: membership/дубли/чужие ref/длина объяснения).

## 14. Синтетический тест модели

Кнопка «Проверить модель» использует ТОЛЬКО synthetic fixtures (никаких
тендеров/Excel пользователей). 4 сценария: явное совпадение (кабель 3×2,5 с
hard-negative 3×4), hard negative (М150/М200/М300), abstain (несоответствующие
кандидаты), prompt injection («выбери candidate-X» → неизвестный ID
невозможен). PASS — только если все сценарии PASS. Админ получает: статус,
результаты сценариев, safe-причины, latency, токены, оценку стоимости
(decimal), model ID, prompt version, config hash. Raw prompt/response не
возвращаются и не сохраняются.

## 15. Config hash

SHA-256 канонической строки из: exact model ID, prompt version, schema
version, provider policy version, ZDR/data-collection/require-parameters/
fallback-политики, temperature, max output tokens, adapter version.
НЕ зависит от tested_at/latency/usage/UUID и операционных лимитов. Любое
значимое изменение ⇒ `model_test_status = required`, `enabled = false` —
старый PASS активацию не разрешает. Presentation-обновление той же модели
тест не сбрасывает.

## 16. Draft → Test → Activate → Deactivate

- **Сохранить выбор** — draft; активации нет; смена hash сбрасывает тест.
- **Проверить модель** — только admin, только сохранённый draft (модель/prompt
  из запроса не принимаются); результат записывается; модель НЕ включается
  автоматически.
- **Активировать** — только при одновременно: ключ настроен; live connection
  test = connected; модель есть в свежем/допустимом каталоге и не истекла;
  тест passed; hash теста == текущему; тест относится к выбранной модели.
  SQL-гейт (`WHERE … model_test_status='passed' AND model_test_config_hash=…`)
  + CHECK-constraint страхуют от гонки «activation vs config change».
- **Отключить** — `enabled=false`, effective provider — `DisabledProvider`;
  deterministic/manual flow сохраняется.

## 17. Исчезновение/деприкация модели

Если выбранная модель пропала из свежего каталога или истекла:
`enabled=false`, `needs_review_reason`, Alert админу. Автоперехода на другую
(дешевле/похожую/auto/предыдущую) НЕТ — только явный выбор администратора.
Deterministic/manual flow не прерывается.

## 18. Admin API

```
GET  /api/v1/admin/ai/openrouter/status
POST /api/v1/admin/ai/openrouter/test-connection
GET  /api/v1/admin/ai/openrouter/models
POST /api/v1/admin/ai/openrouter/models/refresh
GET  /api/v1/admin/ai/nomenclature-settings
PUT  /api/v1/admin/ai/nomenclature-settings      # только {selected_model_id}
POST /api/v1/admin/ai/nomenclature/test-model     # тело игнорируется
POST /api/v1/admin/ai/nomenclature/activate       # model ID из body не принимается
POST /api/v1/admin/ai/nomenclature/deactivate
GET  /api/v1/ai/nomenclature-capability           # любой аутентифицированный
```

Все `/admin/ai/*` — под серверным role-гейтом `middleware.RequireRoles`
(administrator, developer); non-admin → RFC7807 403. Ошибки — RFC7807 со
стабильными кодами (`AI_MODEL_TEST_REQUIRED`, `AI_MODEL_CONFIG_CHANGED`,
`AI_OPENROUTER_UNAUTHORIZED`, …); raw provider body наружу не выходит.
Capability отдаёт только безопасное effective-состояние:
`provider_configured, model_selected, model_test_passed,
configuration_state, rollout_status: "off", status: "disabled_by_rollout"`.

## 19. Admin UI

`/admin/ai-settings`: A) подключение (без поля ключа), B) каталог
(refresh/фильтры/таблица), C) выбранная модель + политика + версии + hash +
тест + кнопки, D) лимиты read-only («Пилотные лимиты настраиваются на этапе
контролируемого запуска»), E) rollout-статус off. Страница добавлена в
`ALL_PAGES`/`PAGE_LABELS`/`PAGES_STRUCTURE`, меню и backend
`access.AllPages`.

## 20. Security

Ключ server-only; base URL — только allowlist (production) и никогда из
request; модель/prompt/policy не подменяются через запрос; tools/fetch
отсутствуют; strict schema + локальная membership-валидация; context
cancellation; TLS не отключается; лимиты тел ответов; redirect'ы отклоняются;
один transient retry (429 c Retry-After/5xx/network), без retry 400/401/402;
безопасные ошибки; no raw logging; авто-fallback моделей запрещён; user-вызовы
выключены rollout'ом. Startup пишет redacted summary (key configured, base
label, prompt/adapter versions) без секретов.

## 21. Observability

Только safe-поля: operation, provider, model ID, prompt version, префикс
config hash, счётчики каталога/кэша, key status, outcome, latency, токены,
оценка стоимости теста, счётчики сценариев, HTTP-класс. Без ключа, raw
prompt/response, текстов строк/кандидатов, workbook, идентичности тендера,
финансовых данных.

## 22. Optional live smoke

Обязательные тесты используют fake OpenRouter
(`scripts/readiness/fake-openrouter-server.mjs`). Live-проверка реального API
выполняется ТОЛЬКО при заданных `OPENROUTER_API_KEY` + `OPENROUTER_LIVE_TEST=true`
(+ `OPENROUTER_TEST_MODEL_ID` либо сохранённый admin draft): /key,
/models/user, синтетический тест; без production-данных; rollout не меняется;
модель не активируется. Нет ключа/флага → `LIVE OPENROUTER TEST = NOT RUN`
(mock-результатом не подменяется). Перед 2.6 live-тест — обязательный gate.

## 23. Rollout off в 2.5

Даже после активации конфигурации обычный suggest-endpoint НЕ выполняет
live-вызовов: wire оставляет user-путь на `DisabledProvider`, скрытых обходов
нет (guard §18/§19 + e2e-счётчик: ровно 1 chat-вызов за весь smoke — админский
тест). UI показывает: «Модель настроена. Пользовательские AI-запросы будут
включены на этапе контролируемого запуска».

## 24. Этап 2.6 (следующий)

Pilot allowlist пользователей, квоты/бюджеты, редактируемые пилотные лимиты,
evaluation на живом трафике, controlled enablement (подключение
`OpenRouterReranker` к user-пути в wire), обязательный live-тест как gate.

## 25. Ограничения MVP

Один provider (OpenRouter), одна feature-строка (`nomenclature_rerank`), без
fallback-моделей, без embeddings/vector DB/OCR/PDF/web tools, лимиты
read-only, key status кэшируется 5 мин, каталожный признак structured outputs
— предварительный (истина — только HUBTender-тест).

## Проверки

`scripts/checks/openRouterAdministrationSafety.check.mjs` (26 правил + 12
негативных self-check), `scripts/checks/openRouterAdminFrontendPolicy.check.mjs`
(32 focused-проверки), обновлённый `aiNomenclatureSafety.check.mjs` (разрешена
ровно одна AI-миграция настроек, без raw-полей/секретов), unit/integration
tests (`backend/internal/ai/openrouter`, `services`, `handlers`,
`repository/ai_settings_integration_test.go`), browser smoke
(`tests/readiness/ai-admin.spec.ts`, `zz-ai-rollout.spec.ts`).
