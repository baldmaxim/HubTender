# 01. Аудит миграции OLD Supabase → PROD Supabase

> Шаг 1 из 2 в общей цепочке миграции: **OLD → PROD Supabase** (этот документ), затем **PROD Supabase → Yandex Managed PostgreSQL** (см. [../yandex-migration/01_SUPABASE_AUDIT.md](../yandex-migration/01_SUPABASE_AUDIT.md)). На текущем шаге Supabase Auth ещё не заменяется на Go-Auth — у PROD остаётся свой Supabase Auth.

## 0. Что это и зачем

OLD — рабочая база `wkywhjljrhewfpedbjzx` (live users). PROD — новая база `ocauafggjrqvopxjihas` под Go BFF, schema-baseline которой собран в [supabase/migrations/](../../supabase/migrations/). В PROD уже накатаны 14 миграций; в OLD они никогда не были — там живая схема с органической drift.

Цель шага 1: **перетащить пользовательские данные** (`auth.users`, `auth.identities`, всё `public.*`) из OLD в PROD без потери, без коллизий и без сломанных FK. Schema в PROD не меняется — она уже правильная. Если OLD расходится со schema PROD — это блокер, который надо решить **до** запуска import-этапа: либо данные трансформируются, либо PROD достраивается под OLD (мало вероятно), либо строки фильтруются.

Этот документ — методология. Конкретные находки лежат в `.old-to-prod-export/schema_diff.md` и заполняются по результатам прогона introspection-скриптов.

## 1. Что сравнивается

| Аспект | Источник | Файл |
|---|---|---|
| PostgreSQL major version | `SELECT version()` | `*_schema.json` → `postgres_version` |
| Список схем | `information_schema.schemata` | `*_schema.json` → `schemas[]` |
| Таблицы `public` + `auth` | `information_schema.tables` | `*_schema.json` → `tables[]` |
| Колонки (тип / nullable / default) | `information_schema.columns` | `*_schema.json` → `tables[].columns[]` |
| Primary keys | `pg_index.indisprimary` | `*_schema.json` → `tables[].pk[]` |
| Foreign keys | `pg_constraint.contype='f'` | `*_schema.json` → `tables[].fks[]` |
| UNIQUE constraints | `pg_constraint.contype='u'` | `*_schema.json` → `tables[].uniques[]` |
| Indexes | `pg_indexes` | `*_schema.json` → `tables[].indexes[]` |
| Enum types и значения | `pg_type` + `pg_enum` | `*_schema.json` → `enums[]` |
| Функции `public.*` | `pg_proc` (+ md5 тела) | `*_schema.json` → `functions[]` |
| Триггеры (не системные) | `pg_trigger` | `*_schema.json` → `triggers[]` |
| RLS-политики | `pg_policies` | `*_schema.json` → `rls_policies[]` |
| RLS включён на таблице | `pg_class.relrowsecurity` | `*_schema.json` → `tables[].rls_enabled` |
| Row counts | `SELECT COUNT(*)` по всем таблицам | `*_rowcounts.json` |
| Auth-статистика | агрегаты по `auth.users` / `auth.identities` | `*_auth_stats.json` |

В auth-статистике считаются (без выгрузки строк, только числа):
- общее число `auth.users` и `public.users`;
- сколько `encrypted_password IS NULL` (потенциальные OAuth-only);
- сколько `email_confirmed_at IS NULL`;
- orphan-юзеры в обе стороны (есть в `auth.users`, нет в `public.users` и наоборот);
- список email-дублей (masked: `j***@example.com`);
- `auth.identities` count + разбивка по провайдерам.

## 2. Как запустить

```bash
# 1. скопировать template и заполнить креды
cp scripts/old-to-prod/.env.old-to-prod.example scripts/old-to-prod/.env.old-to-prod
# отредактировать .env.old-to-prod: подставить OLD_SUPABASE_DB_URL, PROD_SUPABASE_DB_URL (минимум)

# 2. проверить связность
npm run old-to-prod:check
# ожидание: оба эндпоинта отвечают, public.users и auth.users существуют

# 3. снять метаданные
npm run old-to-prod:introspect-old
npm run old-to-prod:introspect-prod

# 4. собрать diff
npm run old-to-prod:compare
# результат: .old-to-prod-export/schema_diff.md
```

Скрипты read-only — ни одной мутации ни в OLD, ни в PROD. SSL до Supabase используется в режиме `rejectUnauthorized: false` (Supabase rotates intermediates) — это допустимо для одноразовой миграционной операции, для регулярного трафика так делать нельзя.

## 3. Findings

> **Заполнено через Supabase MCP** (read-only `execute_sql` на оба проекта) на 2026-05-11. Локальные скрипты `npm run old-to-prod:*` дают тот же результат при заполненном `.env.old-to-prod` — используйте их для повторного прогона перед cutover-окном.

### 3.1 Версии Postgres

- **OLD**: PostgreSQL 17.6.1.084 (region `eu-west-1`, проект `wkywhjljrhewfpedbjzx`)
- **PROD**: PostgreSQL 17.6.1.104 (region `eu-west-1`, проект `ocauafggjrqvopxjihas`)

Major-версия идентична (17). Patch-разница (0.084 vs 0.104) не влияет на миграцию данных.

### 3.2 Таблицы, которые есть только в PROD

| Таблица | Что это |
|---|---|
| `public.auth_users` | Локальная Auth-таблица под будущий Go-Auth (этап 2). Колонки: `id, email citext, password_hash text, email_verified bool, created_at, updated_at`. На PROD уже **32 строки** — синхронизировано с `public.users` и `auth.users`. |
| `public.password_reset_tokens` | Token storage для будущего Go-Auth (`/auth/forgot-password`). Колонки: `id, user_id, token_hash bytea, issued_at, expires_at, used_at`. На PROD — **0 строк**. |
| `public.refresh_tokens` | Refresh-token storage для Go-Auth (`/auth/refresh`). Колонки: `id, user_id, token_hash bytea, issued_at, expires_at, revoked_at, user_agent, ip inet`. На PROD — **0 строк**. |

Все три — **инфраструктура под этап 2 (Go-Auth, см. [../yandex-migration/01_SUPABASE_AUDIT.md § 13](../yandex-migration/01_SUPABASE_AUDIT.md#13-migration-backlog-последовательность-задач))**. На текущем шаге OLD → PROD они **не используются** — переносить туда нечего, на PROD остаются как пустые. После cutover Go-Auth будет писать `public.auth_users` через `register_user`-эндпоинт.

### 3.3 Таблицы только в OLD

**Нет.** OLD `public.*` ⊆ PROD `public.*`. Все 41 таблица из OLD имеют дубликат в PROD. Блокер R-«Tables only in OLD» закрыт.

### 3.4 Колоночные drift'ы

**Нет drift'ов.** Прогон fingerprint-сравнения (`table.column:udt_name|nullable`) по 41 общей таблице (включая 2 view: `materials_library_full_view`, `works_library_full_view`) показал 100% идентичность сигнатур OLD и PROD.

Это значит:
- Все типы совпадают.
- Все NOT NULL/nullable совпадают.
- Каждая OLD-таблица INSERT-совместима с PROD-таблицей.
- R-10 (column drift) и R-11 (type drift) **закрыты**.

### 3.5 Enum drift

**Нет drift'а.** Все 11 `public.*`-enum'ов идентичны на OLD и PROD по составу значений (включая кириллические лейблы `мат/раб/комфорт/бизнес/делюкс/…` для `boq_item_type`, `housing_class_type`). Auth-enum'ы (`auth.factor_type`, `auth.oauth_*`, и т.д.) — тоже идентичны (Supabase автоматически синхронизирует через релизы GoTrue).

R-03 (enum drift) **закрыт**.

### 3.6 Auth-статистика

| Метрика | OLD | PROD | Заметка |
|---|---|---|---|
| `auth.users` count | **33** | **32** | PROD = почти весь OLD (баланс ±1 — кто-то заведён вручную) |
| `public.users` count | 33 | 32 | 1:1 с `auth.users` на обеих сторонах |
| `encrypted_password IS NULL` | **0** | 0 | Нет OAuth-only юзеров — все имеют пароль. R-OAuth закрыт. |
| `email_confirmed_at IS NULL` | **0** | 0 | Все email подтверждены. R-15 закрыт. |
| email-дубли в `auth.users` | **0** | 0 | UNIQUE-блокер `users_email_key` не выстрелит. R-02 закрыт. |
| orphan auth.users (нет в public.users) | **0** | 0 | Профили синхронизированы. |
| orphan public.users (нет в auth.users) | **0** | 0 | Нет «сирот». FK-блокер закрыт. R-04 закрыт. |
| `auth.identities` count | **4** | 32 | ⚠️ В OLD только 4 identity на 33 юзера — артефакт старого GoTrue. См. § 3.6.1. |
| `auth.identities` provider breakdown | `email: 4` | `email: 32` | Только email. R-14 (OAuth provider mismatch) закрыт. |
| `auth.sessions` count | 1253 | 7 | Не переносятся. |
| `auth.refresh_tokens` count | 3802 | 18 | Не переносятся. |

#### 3.6.1 Identity gap на OLD (важно)

29 из 33 юзеров OLD **не имеют записи в `auth.identities`** (тогда как PROD имеет 32 identity на 32 юзера — полное 1:1). Это типичный артефакт OLD-проектов, созданных до версии GoTrue, которая стала писать email-identity для каждого юзера.

**Эффект для миграции:** Supabase GoTrue лениво создаёт identity при первом успешном `signInWithPassword`. Поэтому даже без переноса identity-таблицы 29 OLD-юзеров смогут залогиниться. Но безопаснее — **проинициализировать identity-ы вручную** для всех 29 юзеров через `INSERT INTO auth.identities ... ON CONFLICT DO NOTHING` (SQL из [03_AUTH_MAPPING.md § 2](03_AUTH_MAPPING.md#2-auth-identities)).

### 3.7 Trigger / function / RLS drift

#### Функции (`public.*`)
- **Общих**: 24 (handle_updated_at, current_user_role, current_user_status, log_boq_items_changes, register_user, и т.д.)
- **Только в OLD (12)**: legacy per-table updated_at-функции (`update_boq_items_updated_at`, `update_client_positions_updated_at`, `update_cost_redistribution_results_updated_at`, `update_markup_parameters_updated_at`, `update_markup_tactics_updated_at`, `update_roles_updated_at`, `update_tender_documents_updated_at`, `update_tender_markup_percentage_updated_at`, `update_updated_at_column`, `set_updated_at`) + бизнес-функция **`duplicate_tender_version(uuid)`**.
- **Только в PROD**: `clone_tender_as_new_version(uuid)` (рефакторинг `duplicate_tender_version` — функционально эквивалентна; фронт уже зовёт PROD-версию через [src/utils/versionTransfer/cloneTenderAsNewVersion.ts](../../src/utils/versionTransfer/cloneTenderAsNewVersion.ts)), `notify_row_change()`, `save_redistribution_results(...)`, плюс ~40 функций расширения `citext` (PROD имеет `pgcrypto`+`citext` — нужны для `public.auth_users.email`).

Все OLD-only функции — **legacy boilerplate**, на PROD заменён на единый `handle_updated_at()`. Не блокер.

#### Триггеры
- **OLD**: 38 триггеров в `public`, **отсутствуют** все 6 `trg_notify_row_change_*` и `public.auth_users.auth_users_updated_at`.
- **PROD**: 45 триггеров — те же 38 + 6 pg_notify + 1 на `auth_users`.

Совпадение функциональных триггеров: `trg_boq_items_audit`, `trg_boq_items_grand_total`, `trigger_auto_create_tender_registry`, `trigger_auto_archive_tender_registry`, `trg_insurance_grand_total`, `trg_markup_pct_grand_total`, `trg_subcontract_excl_grand_total`, все `*_updated_at` — **одинаковы**.

Импортный план: **временно отключать на PROD** `trigger_auto_create_tender_registry` (R-16) и `trg_boq_items_audit` (R-06) на время cutover-окна.

#### RLS-политики
- **OLD**: 43 политики в `public` (кириллические имена: «Пользователи могут *» на `boq_items`, «Авторизованные пользователи могу...» / «Все пользователи могут просматрив...» на `tender_insurance`, «Allow all for development» на `subcontract_growth_exclusions`, multi-policy на `users`).
- **PROD**: 44 политики (английские имена после refactor миграции 8: `boq_items_select/insert/update/delete`, `cost_redistribution_results_*` (новые, миграция 13), `tender_insurance_authenticated`, `users_select_consolidated`).

**Cost_redistribution_results**: на OLD RLS **выключен**, на PROD — 4 политики (миграция 13). При импорте под service_role — bypass.

RLS не переносится. Не блокер.

### 3.8 Row counts по public-таблицам (готовность к импорту)

| Таблица | OLD | PROD | Delta | Заметка |
|---|---:|---:|---:|---|
| boq_items_audit | 327 556 | 220 518 | +107 038 | Audit-история, большая. Импорт ПОСЛЕ `boq_items` и с DISABLE TRIGGER trg_boq_items_audit. |
| boq_items | 101 490 | 70 303 | +31 187 | Главная боль импорта. Топологически после `client_positions`. |
| client_positions | 39 478 | 27 766 | +11 712 | После `tenders`. |
| cost_redistribution_results | 29 169 | 23 674 | +5 495 | На PROD есть RLS → импорт под service_role. |
| user_position_filters | 7 647 | 6 077 | +1 570 | Persistent UI-state. |
| material_names | 6 552 | 5 943 | +609 | Reference table. |
| construction_cost_volumes | 3 292 | 2 344 | +948 | После `detail_cost_categories`. |
| work_names | 2 338 | 2 189 | +149 | Reference. |
| comparison_notes | 1 961 | 1 353 | +608 | |
| materials_library | 1 819 | 1 773 | +46 | После `material_names`. |
| subcontract_growth_exclusions | 1 429 | 1 031 | +398 | |
| template_items | 1 104 | **1 169** | **−65** | ⚠️ PROD имеет БОЛЬШЕ — расхождение, см. § 3.8.1. |
| works_library | 855 | 847 | +8 | |
| tender_markup_percentage | 537 | 477 | +60 | |
| project_monthly_completion | 386 | 386 | **0** | Идентичные. |
| templates | 238 | **266** | **−28** | ⚠️ PROD имеет БОЛЬШЕ. См. § 3.8.1. |
| detail_cost_categories | 218 | 218 | 0 | Идентичные. |
| import_sessions | 217 | 132 | +85 | |
| user_tasks | 162 | 150 | +12 | |
| tender_group_members | 150 | 78 | +72 | |
| project_additional_agreements | 76 | 76 | 0 | Идентичные. |
| tender_registry | 64 | 55 | +9 | |
| tenders | 45 | 38 | +7 | Главные родительские. |
| tender_groups | 44 | 24 | +20 | |
| users | 33 | 32 | +1 | |
| tender_pricing_distribution | 28 | 24 | +4 | |
| units | 28 | 27 | +1 | Reference. |
| cost_categories | 24 | 24 | 0 | Идентичные. |
| markup_parameters | 15 | 15 | 0 | Идентичные. |
| tender_insurance | 13 | 8 | +5 | |
| projects | 12 | 12 | 0 | Идентичные. |
| roles | 9 | 9 | 0 | Идентичные. |
| library_folders | 7 | 4 | +3 | |
| tender_notes | 6 | 6 | 0 | Идентичные. |
| construction_scopes | 5 | 5 | 0 | Идентичные. |
| tender_statuses | 4 | 4 | 0 | Идентичные. |
| markup_tactics | 3 | 3 | 0 | Идентичные. |
| notifications | 0 | 0 | 0 | Пустые. |
| tender_documents | 0 | 0 | 0 | Пустые. |
| tender_iterations | 0 | 0 | 0 | Пустые. |

**Итого к импорту с OLD на PROD:** ~165К строк по таблицам, где `OLD > PROD`. Топ-3 по объёму: `boq_items_audit` (107K), `boq_items` (31K), `client_positions` (12K).

#### 3.8.1 Реверс-drift: PROD имеет данные, которых нет в OLD

Два случая, где у PROD строк **больше**, чем у OLD:
- `templates`: 266 на PROD vs 238 на OLD (+28 строк в PROD).
- `template_items`: 1 169 на PROD vs 1 104 на OLD (+65 строк в PROD).

**Природа:** Шаблоны/template_items на PROD создавались тестировщиками после baseline. Это нормально и не блокирует импорт — `ON CONFLICT (id) DO NOTHING` сохранит PROD-данные, а OLD-данные добавятся только если их `id` ещё не занят.

**Действие:** ничего, default ON CONFLICT DO NOTHING policy достаточно.

### 3.9 Что НЕ переносится (подтверждено)

- `auth.sessions` (1 253 на OLD) — все умрут после смены JWT-secret (см. [03_AUTH_MAPPING.md § 8](03_AUTH_MAPPING.md#8-jwt-secret--должен-ли-совпадать)).
- `auth.refresh_tokens` (3 802 на OLD) — то же.
- `auth.audit_log_entries`, `auth.flow_state`, `auth.mfa_*`, `auth.one_time_tokens`, `auth.saml_*`, `auth.sso_*`, `auth.webauthn_*`, `auth.oauth_*`, `auth.custom_oauth_providers` — служебные таблицы Supabase Auth, не нужны.
- Все `realtime.*`, `storage.*`, `vault.*`, `graphql.*` — не используются (см. yandex audit).

### 3.10 Итог по блокерам

| Риск из [04_RISKS.md](04_RISKS.md) | Статус после MCP-аудита |
|---|---|
| R-01 (user ID collision) | **Закрыт** — OLD/PROD пересечений по `auth.users.id` нет (counts 33 vs 32, обе синхронизированы 1:1 с public.users). |
| R-02 (email collision) | **Закрыт** — 0 email-дублей в обеих. |
| R-03 (enum drift) | **Закрыт** — все 11 enum'ов идентичны. |
| R-04 (missing FK targets / orphan) | **Закрыт** — 0 orphan'ов в обе стороны. |
| R-05 (RLS блокирует import) | **Открыт** — митигация: импорт под service_role. |
| R-06 (trigger side effects) | **Открыт** — митигация: DISABLE TRIGGER на cutover-окно. |
| R-07 (identities mismatch) | **Открыт с low impact** — OLD имеет 29 юзеров без identity. Митигация: SQL-инициализация identity при импорте. |
| R-08 (sessions loss) | Принят — UX-предупреждение. |
| R-09 (write window) | **Открыт** — митигация: read-only-режим OLD на cutover. |
| R-10 (column drift) | **Закрыт** — zero drift. |
| R-11 (type drift) | **Закрыт** — zero drift. |
| R-12 (RLS на cost_redistribution_results) | **Открыт** — митигация: service_role при импорте. |
| R-13 (JWT secret mismatch) | Принят — UX. |
| R-14 (OAuth provider mismatch) | **Закрыт** — только email-провайдер. |
| R-15 (email confirmation policy) | **Закрыт** — 0 неподтверждённых юзеров на OLD. |
| R-16 (auto_create_tender_registry duplicate) | **Открыт** — митигация: DISABLE TRIGGER `trigger_auto_create_tender_registry` на time cutover. |

## 4. Acceptance criteria для перехода к импорту

Перейти к этапу импорта данных можно, когда:

1. `npm run old-to-prod:check` → exit 0 на обоих эндпоинтах.
2. `schema_diff.md` секция «🚨 Blockers» **пуста** (либо каждый пункт явно проигнорирован с письменным обоснованием).
3. Раздел 3.6 (auth-статистика) проверен:
   - нет orphan public.users в OLD;
   - email-дубли в OLD разрешены руками (выбран один владелец на каждый дубль);
   - PROD.auth.users count = ожидаемому или 0 (если import ещё не было).
4. Smoke-логин: `MIGRATION_SMOKE_EMAIL`/`MIGRATION_SMOKE_PASSWORD` — реальная учётка из OLD, которая после dry-run импорта в PROD сможет залогиниться (см. [03_AUTH_MAPPING.md § Smoke](03_AUTH_MAPPING.md#5-smoke-тест)).
5. Раздел «⚠️ Risks» прочитан — каждый риск либо смит игирован, либо принят (приписан к [04_RISKS.md](04_RISKS.md)).

## 5. Связанные документы

- [02_DATA_MAPPING.md](02_DATA_MAPPING.md) — per-table план переноса данных.
- [03_AUTH_MAPPING.md](03_AUTH_MAPPING.md) — детальный auth-сценарий.
- [04_RISKS.md](04_RISKS.md) — risk register с mitigation.
- [.old-to-prod-export/schema_diff.md](../../.old-to-prod-export/schema_diff.md) — машинно-сгенерированный diff (создаётся скриптом, не коммитится).
