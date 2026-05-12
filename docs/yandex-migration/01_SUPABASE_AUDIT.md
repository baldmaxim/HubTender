# 01. Аудит зависимостей HubTender от Supabase

> Документ собран перед миграцией на Yandex Managed PostgreSQL. Источники: исходники репозитория на 2026-05-11, ветка `main`, коммит `b2296fb`. Все ссылки — на файлы и строки этого репо.

## 0. TL;DR

- Фронт всё ещё хардово сидит на `@supabase/supabase-js@^2.80.0` — Auth и JWT-сессии полностью завязаны на Supabase Auth ([src/lib/supabase/client.ts:1-29](../../src/lib/supabase/client.ts#L1-L29), [src/contexts/AuthContext.tsx](../../src/contexts/AuthContext.tsx)).
- Data-плоскость на фронте уже на 18/18 доменов имеет Go BFF-маршрут с feature-флагами `VITE_API_*_ENABLED` ([.env.example:21-46](../../.env.example#L21-L46)), и в `.env.example` все они уже `true`.
- Go BFF (`backend/`) не использует PostgREST/RLS/`auth.uid()` ни в одном репозитории — авторизация делается приложением, БД — обычный pgx. См. [backend/internal/middleware/auth.go:64-92](../../backend/internal/middleware/auth.go#L64-L92).
- БД-схема: 40 RLS-политик, 6 SQL-функций и 8 FK ссылаются на `auth.users`/`auth.uid()`. Это и есть основной блокер прямого `psql < prod.sql` в Yandex.
- Realtime уже мигрирован на нативный `LISTEN/NOTIFY` (см. [supabase/migrations/00000000000012_pgnotify_triggers.sql](../../supabase/migrations/00000000000012_pgnotify_triggers.sql), [backend/internal/realtime/](../../backend/internal/realtime/)) — Supabase Realtime не используется.
- Supabase Storage, GraphQL и Vault/pgsodium объявлены в `prod.sql`, но в реальных данных и коде **не используются** — при миграции опускаем.

## 1. Главная таблица: что зависит от Supabase и чем заменить

| # | Supabase-функция | Где используется (файлы) | Что делает | Замена в Yandex / PostgreSQL / Go BFF | Приоритет | Риск |
|---|---|---|---|---|---|---|
| 1 | `supabase.auth.signInWithPassword` | [src/pages/Auth/Login.tsx:43](../../src/pages/Auth/Login.tsx#L43) | Email/password логин | Свой `POST /api/v1/auth/login` в Go: проверка bcrypt-хэша из `public.users`, выдача JWT (HS256/RS256) | critical | high |
| 2 | `supabase.auth.signUp` | [src/pages/Auth/Register.tsx:31](../../src/pages/Auth/Register.tsx#L31) | Регистрация пользователя в `auth.users` | `POST /api/v1/auth/register` в Go: вставка в `public.users` (со своим `password_hash`), затем существующий `POST /api/v1/users/register` для профиля | critical | high |
| 3 | `supabase.auth.signOut` | AuthContext.tsx:81, Register.tsx:75/112, Login.tsx, ResetPassword.tsx:83 | Очистка сессии | Сделать клиентский `signOut()` = удалить токен из localStorage + вызвать `POST /api/v1/auth/logout` (если будут refresh-токены на сервере) | critical | medium |
| 4 | `supabase.auth.getSession` | [src/lib/api/client.ts:36-39](../../src/lib/api/client.ts#L36-L39), AuthContext.tsx:70, supabaseWithAudit.ts, ws.ts | Достаёт access_token для `Authorization: Bearer` | Хранить токен в `localStorage` + новый хелпер `getAccessToken()` в `src/lib/auth/` | critical | medium |
| 5 | `supabase.auth.onAuthStateChange` | AuthContext.tsx:97, ResetPassword.tsx:64 | Реактивно ловит INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED / SIGNED_OUT | Свой `EventEmitter` в `src/lib/auth/`, эмитит при login/logout/refresh | critical | high |
| 6 | `supabase.auth.resetPasswordForEmail` | [src/pages/Auth/ForgotPassword.tsx:21](../../src/pages/Auth/ForgotPassword.tsx#L21) | Шлёт recovery-email с `redirectTo` | `POST /api/v1/auth/forgot-password` → Go генерит токен, кладёт в `password_reset_tokens`, шлёт письмо через SMTP (Yandex SES/Postmark/собственный) | critical | high |
| 7 | `supabase.auth.updateUser({password})` | [src/pages/Auth/ResetPassword.tsx:112](../../src/pages/Auth/ResetPassword.tsx#L112) | Меняет пароль по recovery-сессии | `POST /api/v1/auth/reset-password` с токеном из URL | critical | high |
| 8 | `supabase.auth.getUser` | src/pages/CostRedistribution/hooks/useSaveResults.ts:52 | Достать текущего юзера для `created_by` | Брать из локального AuthContext (уже есть) | low | low |
| 9 | `supabase.from(...)` — read | См. раздел 3 (PostgREST) | Прямое чтение таблиц через PostgREST | Удалить — все домены покрыты Go BFF, нужно только переключить флаг (он уже `true` в `.env.example`) и снести `else`-ветки в `src/lib/api/*` | high | medium |
| 10 | `supabase.from(...)` — write (`insert/update/delete/upsert`) | См. раздел 3 | Прямые мутации через PostgREST | Часть уже покрыта Go BFF, часть **не покрыта** (см. раздел 8) | critical | high |
| 11 | `supabase.rpc(...)` | См. раздел 4 | 13 RPC-функций (через PostgREST) | Часть портирована в Go, часть — нет (раздел 8) | critical | high |
| 12 | `supabase.channel(...)` / `supabase.removeChannel(...)` | Старые call-site'ы за флагом `VITE_API_REALTIME_ENABLED` | Realtime-подписки на Supabase Broadcast | **Уже заменено** на Go WebSocket-хаб ([src/lib/realtime/ws.ts](../../src/lib/realtime/ws.ts), [backend/internal/realtime/](../../backend/internal/realtime/)). При cutover просто оставляем флаг `true` и удаляем Supabase-ветки | medium | low |
| 13 | Schema `auth.*` (auth.users, auth.uid(), auth.role()) | См. разделы 6, 9, 10 | Хранилище учёток + JWT-claim accessor | В Yandex этой схемы нет. Перенести нужные колонки `auth.users` в `public.users`, заменить `auth.uid()` на `current_setting('app.user_id')` или параметризовать функции | critical | high |
| 14 | Schema `storage.*` | [supabase/schemas/prod.sql](../../supabase/schemas/prod.sql) (декларации) | S3-совместимый файл-стор | **Не используется** — нет ни одного `supabase.storage.*` в коде → опустить | low | low |
| 15 | Schema `realtime.*` | prod.sql | Supabase Broadcast | **Не используется** (заменено `pg_notify`) → опустить | low | low |
| 16 | Schema `vault.*` (pgsodium) | prod.sql | Зашифрованные секреты | **Не используется** (vault.secrets пуст) → опустить | low | low |
| 17 | Schema `graphql.*` (pg_graphql) | prod.sql | GraphQL endpoint Supabase | **Не используется** → опустить | low | low |
| 18 | Roles `anon` / `authenticated` / `service_role` / `authenticator` | prod.sql, миграция 8 (RLS) | PostgREST switch-role | Создать как обычные роли (без логина) для совместимости политик ИЛИ снести RLS целиком (рекомендация — см. раздел 11) | high | medium |
| 19 | `SUPABASE_JWKS_URL` (RS256) / `SUPABASE_JWT_SECRET` (HS256) | [backend/internal/config/config.go](../../backend/internal/config/config.go), [backend/internal/middleware/auth.go:64-92](../../backend/internal/middleware/auth.go#L64-L92) | JWKS endpoint для проверки подписи JWT | Свой Go-issuer с собственным ключом (RS256) или `JWT_SECRET` (HS256). Переменные останутся, но укажут на наш `/.well-known/jwks.json` | critical | medium |
| 20 | `SUPABASE_JWT_ISSUER` | config.go, auth.go | Ожидаемый `iss` claim | Поменять значение на наш домен (`https://api.hubtender.<…>/auth`) | critical | low |
| 21 | `SUPABASE_SERVICE_ROLE_KEY` | scripts/dual-run/*, scripts/archive/*, `.env.example:58` | Bypass RLS из админ-скриптов | После миграции — прямой `DATABASE_URL` с админ-юзером (RLS либо снят, либо в Yandex проверяется приложением) | medium | medium |
| 22 | Connection-URL формата `aws-0-…pooler.supabase.com:5432` | `.env.example:71`, [README.md](../../README.md), [CLAUDE.md](../../CLAUDE.md) | Session Pooler Supabase | Yandex Managed PG отдаёт обычный `c-<cluster>.rw.mdb.yandexcloud.net:6432` (PgBouncer transaction mode) или `:5432` (без пулера). pgx с prepared statements требует session-mode | high | medium |

---

## 2. Supabase Auth usage

### 2.1 Используемые методы клиентского SDK

| Метод | Файлы | Назначение |
|---|---|---|
| `signInWithPassword` | [Login.tsx:43](../../src/pages/Auth/Login.tsx#L43) | Логин по email/паролю |
| `signUp` | [Register.tsx:31](../../src/pages/Auth/Register.tsx#L31) | Регистрация в `auth.users` (затем мы зеркалим в `public.users` через RPC `register_user`) |
| `signOut` | [AuthContext.tsx:81](../../src/contexts/AuthContext.tsx#L81), [Register.tsx:75](../../src/pages/Auth/Register.tsx#L75), [Register.tsx:112](../../src/pages/Auth/Register.tsx#L112), [Login.tsx:130](../../src/pages/Auth/Login.tsx#L130), [Login.tsx:192](../../src/pages/Auth/Login.tsx#L192), [Login.tsx:249](../../src/pages/Auth/Login.tsx#L249), [ResetPassword.tsx:83](../../src/pages/Auth/ResetPassword.tsx#L83) | Выход |
| `getSession` | [client.ts:36-39](../../src/lib/api/client.ts#L36-L39), [AuthContext.tsx:70](../../src/contexts/AuthContext.tsx#L70), [ResetPassword.tsx:39](../../src/pages/Auth/ResetPassword.tsx#L39), [ResetPassword.tsx:105](../../src/pages/Auth/ResetPassword.tsx#L105), src/lib/supabaseWithAudit.ts:11/35/58, [src/lib/realtime/ws.ts](../../src/lib/realtime/ws.ts) | Достать access_token (для `Authorization: Bearer`) |
| `onAuthStateChange` | [AuthContext.tsx:97](../../src/contexts/AuthContext.tsx#L97), [ResetPassword.tsx:64](../../src/pages/Auth/ResetPassword.tsx#L64) | Reactive-подписка на смену сессии |
| `updateUser({password})` | [ResetPassword.tsx:112](../../src/pages/Auth/ResetPassword.tsx#L112) | Установка нового пароля после recovery |
| `resetPasswordForEmail` | [ForgotPassword.tsx:21](../../src/pages/Auth/ForgotPassword.tsx#L21) с `redirectTo: ${baseUrl}/reset-password` | Письмо с recovery-токеном |
| `getUser` | src/pages/CostRedistribution/hooks/useSaveResults.ts:52 | Текущий пользователь (можно заменить на AuthContext) |

### 2.2 Опции клиента Supabase

[src/lib/supabase/client.ts:12-29](../../src/lib/supabase/client.ts#L12-L29):
- `autoRefreshToken: true` → автообновление JWT (нужно повторить в своём SDK).
- `persistSession: true` → сессия в localStorage.
- `detectSessionInUrl: true` → парсит `#access_token=…&type=recovery` (ключевое для ResetPassword.tsx).
- `realtime.timeout: 30000` → не используется после перехода на нативный WS.

### 2.3 Серверная проверка JWT в Go BFF

[backend/internal/middleware/auth.go:64-92](../../backend/internal/middleware/auth.go#L64-L92):
- JWKS auto-refresh через `github.com/MicahParks/keyfunc/v3` (1 ч интервал, hardcoded в `main.go`).
- Проверяются `exp`, `iat`, `iss == SUPABASE_JWT_ISSUER`, `sub != ""`.
- Clock skew регулируется `JWT_CLOCK_SKEW_SECONDS` (default 0).
- `AuthUser.ID` = `sub` (Supabase UUID). На это ID завязаны все `created_by`/`user_id` колонки.

**Что это значит для миграции:** Go-слой агностичен к issuer. Достаточно встать свой собственный JWKS-сервис (Go может выпустить keypair при старте и держать в файле/секрете) — middleware код не меняется.

---

## 3. Supabase PostgREST usage (`supabase.from(...)`)

Все вызовы `supabase.from()` находятся в `src/lib/api/*.ts` (как fallback-ветка `if (!isGoEnabled('<domain>')) { return supabase.from(...) }`), а также в нескольких хук-файлах. Полный список **таблиц**, к которым ходят:

`users`, `roles`, `tenders`, `tender_iterations`, `tender_statuses`, `tender_registry`, `construction_scopes`, `boq_items`, `client_positions`, `material_names`, `work_names`, `units`, `cost_categories`, `detail_cost_categories`, `locations`, `markup_tactics`, `markup_parameters`, `tender_markup_percentage`, `subcontract_growth_exclusions`, `tender_pricing_distribution`, `tender_insurance`, `projects`, `project_additional_agreements`, `project_monthly_completion`, `user_position_filters`, `notifications`, `import_sessions`.

**Сценарии записи**, оставшиеся прямо на PostgREST (не покрытые Go BFF на момент аудита):
- `tender_iterations` — `INSERT` в [src/lib/api/timeline.ts](../../src/lib/api/timeline.ts) (`createTenderIteration` не имеет Go-аналога).
- Версионирование тендера — `clone_tender_as_new_version`, `execute_version_transfer` ([src/utils/versionTransfer/](../../src/utils/versionTransfer/)) дёргаются через RPC.
- `bulk_import_client_position_boq` — масс-импорт BOQ ([src/pages/ClientPositions/hooks/useMassBoqImport.ts:411](../../src/pages/ClientPositions/hooks/useMassBoqImport.ts#L411)) — через RPC, **но** есть `POST /api/v1/imports/boq` в Go (нужно проверить совместимость API).
- `supabaseWithAudit.ts` (deprecated, но используется в [src/pages/PositionItems/hooks/useAuditRollback.ts](../../src/pages/PositionItems/hooks/useAuditRollback.ts)) — `INSERT/UPDATE/DELETE` через 3 RPC (`insert/update/delete_boq_item_with_audit`). Запись BOQ в Go уже есть (`PATCH /api/v1/items/{id}` и т.д.), но audit-rollback хука это пока не использует.

**Полный grep по `supabase.from(`:** 40+ call-site'ов, все либо за флагом, либо в auth/admin-страницах. См. таблицы выше.

---

## 4. Supabase RPC usage (`supabase.rpc(...)`)

| RPC-функция | Где зовётся | Параметры | Статус в Go BFF |
|---|---|---|---|
| `register_user` | [src/lib/api/users.ts:33](../../src/lib/api/users.ts#L33) | `p_user_id, p_full_name, p_email, p_role_code, p_allowed_pages` | OK — `POST /api/v1/users/register` |
| `get_positions_with_costs` | [src/lib/api/positions.ts:61](../../src/lib/api/positions.ts#L61) | `p_tender_id` | OK — `GET /api/v1/tenders/:id/positions/with-costs` |
| `bulk_update_boq_items_commercial_costs` | [src/lib/api/boq.ts:32](../../src/lib/api/boq.ts#L32) | `p_rows` | OK — `PATCH /api/v1/items/bulk-commercial` |
| `set_tender_group_quality` | [src/lib/api/timeline.ts:55](../../src/lib/api/timeline.ts#L55) | `p_group_id, p_quality_level, p_quality_comment` | OK — `POST /api/v1/timeline/groups/:id/quality` |
| `respond_tender_iteration` | [src/lib/api/timeline.ts:84](../../src/lib/api/timeline.ts#L84) | `p_iteration_id, p_manager_comment, p_approval_status` | OK — `POST /api/v1/timeline/iterations/:id/respond` |
| `save_redistribution_results` | [src/lib/api/redistributions.ts:58](../../src/lib/api/redistributions.ts#L58) | `p_tender_id, p_markup_tactic_id, p_records, p_rules, p_created_by` | OK — `POST /api/v1/redistributions/save` |
| `insert_boq_item_with_audit` | [src/lib/supabaseWithAudit.ts:108](../../src/lib/supabaseWithAudit.ts#L108) | сложный JSONB | ЧАСТИЧНО — Go пишет audit через ту же tx ([backend/internal/repository/boq_mutate.go](../../backend/internal/repository/boq_mutate.go)), но фронт всё ещё дёргает RPC из устаревшего модуля |
| `update_boq_item_with_audit` | supabaseWithAudit.ts:151 | сложный JSONB | ЧАСТИЧНО — то же |
| `delete_boq_item_with_audit` | supabaseWithAudit.ts:182 | сложный JSONB | ЧАСТИЧНО — то же |
| `clone_tender_as_new_version` | [src/utils/versionTransfer/cloneTenderAsNewVersion.ts:21](../../src/utils/versionTransfer/cloneTenderAsNewVersion.ts#L21) | `p_tender_id` | НЕТ в Go |
| `execute_version_transfer` | [src/utils/versionTransfer/executeVersionTransfer.ts:42](../../src/utils/versionTransfer/executeVersionTransfer.ts#L42) | `p_old_tender_id, p_new_tender_id` | НЕТ в Go (есть `POST /api/v1/tenders/{id}/versions/transfer` — проверить контракт) |
| `bulk_import_client_position_boq` | [src/pages/ClientPositions/hooks/useMassBoqImport.ts:411](../../src/pages/ClientPositions/hooks/useMassBoqImport.ts#L411) | сложный JSONB | ЧАСТИЧНО — в Go есть `POST /api/v1/imports/boq`, надо сверить сигнатуры |
| `check_rls_status` | src/utils/checkDatabaseStructure.ts:134 | служебная | НЕ нужна после ухода от RLS |

---

## 5. Supabase Realtime usage

### Текущее состояние — миграция уже сделана

- Триггеры `pg_notify('rowchange', ...)` живут на 6 таблицах ([supabase/migrations/00000000000012_pgnotify_triggers.sql:66-89](../../supabase/migrations/00000000000012_pgnotify_triggers.sql#L66-L89)): `tenders`, `notifications`, `boq_items`, `client_positions`, `cost_redistribution_results`, `construction_cost_volumes`.
- Go BFF держит выделенный `pgx.Conn` под `LISTEN rowchange`, дебаунсит события 200 мс и фанаутит подписчикам через WebSocket ([backend/internal/realtime/](../../backend/internal/realtime/)).
- Фронт: единственный хук [src/lib/realtime/useRealtimeTopic.ts](../../src/lib/realtime/useRealtimeTopic.ts) поверх [src/lib/realtime/ws.ts](../../src/lib/realtime/ws.ts), флаг `VITE_API_REALTIME_ENABLED=true` (уже включён в `.env.example`).
- `supabase.channel(...)` — старые call-site'ы за `if (!isRealtimeEnabled())`. После cutover можно выпилить.

### Что нужно для Yandex

- Триггеры `pg_notify` работают как есть.
- `LISTEN/NOTIFY` доступен в Yandex Managed PG при **прямом подключении** (порт 5432), **не через PgBouncer transaction-pool**. У Yandex есть оба эндпоинта — нужно явно указать direct-host (port 5432).
- Никаких изменений в Go-коде не нужно.

---

## 6. Supabase SQL objects: tables/functions/triggers/RLS/extensions

### 6.1 Расширения (`CREATE EXTENSION`)

[supabase/migrations/00000000000001_baseline_extensions_and_enums.sql:5-6](../../supabase/migrations/00000000000001_baseline_extensions_and_enums.sql#L5-L6):

| Расширение | Используется | Доступно в Yandex Managed PG | Действие |
|---|---|---|---|
| `uuid-ossp` | да (PK через `uuid_generate_v4()`) | да | оставить |
| `pgcrypto` | да | да | оставить |
| `pg_graphql` | объявлено в `prod.sql`, не используется | нет | удалить из миграции |
| `pgsodium` / `vault` | объявлено, не используется | нет | удалить |
| `pg_cron` | упоминается в `extensions.grant_pg_cron_access`, прода-job нет | есть в Yandex, включается отдельно | пропустить, если не понадобится |
| `pg_net` (`net.http_*`) | объявлено, не используется | нет | удалить |

### 6.2 Схемы из `supabase/schemas/prod.sql`

- `auth.*` — 19 таблиц + функции (`auth.uid()`, `auth.role()`, `auth.jwt()`). Управляется Supabase Auth-сервисом, в Yandex такой схемы нет.
- `storage.*` — пустая схема, файлы не льются.
- `realtime.*` — Supabase Broadcast, заменено на `pg_notify`.
- `vault.*` — секреты, не используется.
- `graphql.*`, `graphql_public.*`, `extensions.*` — служебные.
- `public.*` — единственная, которую переносим.

### 6.3 Триггеры

Из [supabase/migrations/00000000000006_baseline_triggers.sql](../../supabase/migrations/00000000000006_baseline_triggers.sql) + [00000000000012_pgnotify_triggers.sql](../../supabase/migrations/00000000000012_pgnotify_triggers.sql):

| Группа | Кол-во | Зависит от `auth.uid()`? |
|---|---|---|
| `BEFORE UPDATE`-триггеры `*_updated_at` → `handle_updated_at()` | 31 | нет |
| Аудит-триггер `trg_boq_items_audit` → `log_boq_items_changes()` | 1 | **да** |
| Бизнес-логика (`grand_total`, `auto_archive_tender_registry`, `auto_create_tender_registry`, и т.д.) | ~7 | нет |
| `pg_notify`-триггеры (`trg_notify_row_change_*`) | 6 | нет |

### 6.4 RLS-политики

[supabase/migrations/00000000000008_baseline_rls.sql:1-296](../../supabase/migrations/00000000000008_baseline_rls.sql#L1-L296): **40 политик** на 15 таблицах. **Все** используют `(SELECT auth.uid())` и `TO authenticated`. Затронуты:

`boq_items`, `comparison_notes`, `import_sessions`, `library_folders`, `markup_tactics`, `project_additional_agreements`, `project_monthly_completion`, `projects`, `subcontract_growth_exclusions`, `tender_documents`, `tender_group_members`, `tender_groups`, `tender_insurance`, `tender_iterations`, `tender_notes`, `users`.

### 6.5 SQL-функции в `public`

Большая часть — независимы от `auth.uid()` (`bulk_*`, `get_positions_with_costs`, `auto_archive_tender_registry`, `handle_updated_at`, и т.д.). Зависимые — см. раздел 9.

---

## 7. Endpoint-ы Go BFF, которые уже есть

Реальный список из [backend/cmd/server/main.go:208-413](../../backend/cmd/server/main.go#L208-L413) и [backend/internal/handlers/](../../backend/internal/handlers/). Группами:

**Public (без auth):** `GET /health`, `GET /health/db`, `GET /health/cache`.

**Me/Permissions:** `GET /api/v1/me`, `GET /api/v1/me/permissions`.

**References (cached, read-only):** `GET /api/v1/references/{roles|units|material-names|work-names|cost-categories|detail-cost-categories}`.

**Tenders:** `GET /api/v1/tenders`, `GET /api/v1/tenders/{id}/overview`, `POST /api/v1/tenders`, `PATCH /api/v1/tenders/{id}` (If-Match), `GET /api/v1/tenders/{id}` (для FI).

**Positions:** `GET /api/v1/tenders/{id}/positions`, `POST /api/v1/positions`, `PATCH /api/v1/positions/{id}`, `GET /api/v1/tenders/{id}/positions/with-costs`.

**BOQ items:** `GET /api/v1/tenders/{id}/positions/{posId}/items`, `GET /api/v1/items/{id}` (ETag), `POST /api/v1/tenders/{id}/positions/{posId}/items`, `PATCH /api/v1/items/{id}`, `DELETE /api/v1/items/{id}`, `PATCH /api/v1/items/bulk-commercial`, `GET /api/v1/tenders/{id}/boq-items-flat`.

**Timeline:** `POST /api/v1/timeline/groups/{id}/quality`, `POST /api/v1/timeline/iterations/{id}/respond`.

**Users (self-register):** `POST /api/v1/users/register`.

**Admin/users:** `GET/POST/PATCH/DELETE /api/v1/admin/users*`, `GET /api/v1/admin/users/count-by-role`, `PATCH /api/v1/admin/users/by-role/{code}/allowed-pages`, `GET /api/v1/admin/tenders-for-access`.

**Admin/roles:** `GET/POST/PATCH/DELETE /api/v1/admin/roles*`.

**Markup (tactics + parameters + percentages + pricing-distribution + exclusions):** ~20 эндпоинтов под `/api/v1/markup/*` и `/api/v1/tenders/{id}/markup/*` и `/api/v1/tenders/{id}/pricing-distribution`.

**Costs / categories:** `GET/POST/PATCH/DELETE /api/v1/cost-categories(/{id})`, `/api/v1/detail-cost-categories(/{id})`, `GET /api/v1/locations`, `GET /api/v1/units/active`, `POST /api/v1/units/import-batch`.

**Nomenclatures:** `units`, `material-names`, `work-names` + `remap` (см. полный список в [backend/cmd/server/main.go](../../backend/cmd/server/main.go)).

**Tender registry:** `GET /api/v1/tender-registry`, `GET /api/v1/tender-registry/{next-sort-order|autocomplete|tender-numbers|related-tenders}`, `POST/PATCH`, `GET /api/v1/tender-statuses`, `GET /api/v1/construction-scopes`.

**Projects:** `POST/PATCH/DELETE /api/v1/projects(/{id})`, `GET /api/v1/projects/active-tenders`, `/api/v1/projects/{id}/agreements`, `/api/v1/project-agreements/*`, `/api/v1/project-monthly-completion/*`.

**Insurance:** `GET/PUT /api/v1/tenders/{id}/insurance`.

**Position filters:** `GET/PUT/POST(/append)/DELETE /api/v1/tenders/{id}/position-filters`.

**Notifications:** `POST /api/v1/notifications`.

**Import log:** `GET /api/v1/import-sessions(*)`, `POST /api/v1/import-sessions/{id}/cancel`.

**Subcontracts:** `POST /api/v1/tenders/{id}/subcontract-exclusions/toggle`.

**Redistribution:** `POST /api/v1/redistributions/save`.

**Bulk imports:** `POST /api/v1/imports/boq`.

**Version transfer:** `POST /api/v1/tenders/{id}/versions/transfer`.

**Realtime:** `GET /api/v1/ws` (JWT через query param).

---

## 8. Endpoint-ы Go BFF, которых не хватает

| Что нужно | Сейчас как делается | Почему критично |
|---|---|---|
| `POST /api/v1/auth/login` | `supabase.auth.signInWithPassword` | Без него фронт нельзя отвязать от Supabase Auth |
| `POST /api/v1/auth/register` | `supabase.auth.signUp` → RPC `register_user` | То же |
| `POST /api/v1/auth/logout` | `supabase.auth.signOut` | Чтобы прибить refresh-токен, если он будет на сервере |
| `POST /api/v1/auth/refresh` | автообновление в SDK | Заменяет `autoRefreshToken: true` |
| `POST /api/v1/auth/forgot-password` | `supabase.auth.resetPasswordForEmail` | Нужна интеграция с почтовой службой (SES/SMTP) |
| `POST /api/v1/auth/reset-password` | `supabase.auth.updateUser({password})` | Принимает recovery-токен из письма |
| `GET /.well-known/jwks.json` | Supabase JWKS | Свой issuer для RS256 |
| `POST /api/v1/timeline/iterations` (создание новой итерации) | `supabase.from('tender_iterations').insert(...)` в [src/lib/api/timeline.ts](../../src/lib/api/timeline.ts) | Это write-path, который остался на PostgREST |
| `POST /api/v1/tenders/{id}/versions/clone` (или встроить в существующий `versions/transfer`) | RPC `clone_tender_as_new_version` | Сейчас фронт зовёт RPC напрямую |
| Аудит-обёртки CRUD на BOQ для отката (`useAuditRollback`) | RPC `*_boq_item_with_audit` через `supabaseWithAudit.ts` | Go уже умеет PATCH/DELETE с аудитом — нужно перевести `useAuditRollback` на эти эндпоинты |
| Проверка контракта: `POST /api/v1/imports/boq` ↔ RPC `bulk_import_client_position_boq` | RPC через `useMassBoqImport` | Возможно, контракт совпадает — нужно проверить тестом |

---

## 9. Какие SQL-функции используют `auth.uid()`

[supabase/migrations/00000000000005_baseline_functions.sql](../../supabase/migrations/00000000000005_baseline_functions.sql) — 6 функций:

| Функция | Где `auth.uid()` | SECURITY |
|---|---|---|
| `public.current_user_role()` | `SELECT role_code FROM public.users WHERE id = auth.uid()` | DEFINER |
| `public.current_user_status()` | `SELECT access_status FROM public.users WHERE id = auth.uid()` | DEFINER |
| `public.log_boq_items_changes()` | `v_user_id := auth.uid()` (audit-trigger) | DEFINER |
| `public.is_tender_timeline_privileged()` | `WHERE u.id = auth.uid()` | DEFINER |
| `public.respond_tender_iteration(...)` | `SET manager_id = auth.uid()` | DEFINER |
| `public.set_tender_group_quality(...)` | `SET quality_updated_by = auth.uid()` | DEFINER |

Плюс — все 40 RLS-политик (раздел 6.4).

**Замена в Yandex:**
- Вариант A (рекомендуется): добавить параметр `p_user_id uuid` в функции, передавать из Go. Триггер `log_boq_items_changes` — читать `current_setting('app.user_id', true)::uuid`, которое Go выставляет через `SET LOCAL` в начале каждой транзакции мутации.
- Вариант B: создать функцию `public.auth_uid()`, возвращающую `current_setting('app.user_id', true)::uuid`. Точечно заменить `auth.uid()` → `auth_uid()`. Минимально инвазивно.

---

## 10. Внешние ключи, ссылающиеся на `auth.users`

[supabase/migrations/00000000000003_baseline_foreign_keys_and_unique.sql:30-189](../../supabase/migrations/00000000000003_baseline_foreign_keys_and_unique.sql#L30-L189):

| Таблица | Колонка | Constraint | ON DELETE |
|---|---|---|---|
| `public.users` | `id` | `users_id_fkey` | CASCADE |
| `public.tenders` | `created_by` | `tenders_created_by_fkey` | (не задано → NO ACTION) |
| `public.markup_tactics` | `user_id` | `markup_tactics_user_id_fkey` | NO ACTION |
| `public.import_sessions` | `user_id` | `import_sessions_user_id_fkey` | NO ACTION |
| `public.import_sessions` | `cancelled_by` | `import_sessions_cancelled_by_fkey` | NO ACTION |
| `public.tender_registry` | `created_by` | `tender_registry_created_by_fkey` | NO ACTION |
| `public.tender_notes` | `user_id` | `tender_notes_user_id_fkey` | CASCADE |
| `public.comparison_notes` | `created_by` | `comparison_notes_created_by_fkey` | NO ACTION |
| `public.cost_redistribution_results` | `created_by` | `cost_redistribution_results_created_by_fkey` | NO ACTION |

**Замена в Yandex:** перевесить все FK на `public.users.id` (он и так уже PK, и `public.users.id = auth.users.id` по дизайну Supabase). `public.users_id_fkey` → удалить (это циклическая ссылка после переноса).

---

## 11. Почему `supabase/schemas/prod.sql` нельзя накатывать напрямую в Yandex Managed PostgreSQL

1. **Нет схемы `auth`** — все 19 таблиц `auth.*` управляются сервисом Supabase Auth, в Yandex его нет.
2. **Функция `auth.uid()` не существует** — 6 функций и 40 RLS-политик упадут.
3. **Роли `anon`, `authenticated`, `service_role`, `authenticator` не созданы** — Yandex даёт только своего `<cluster>_admin` и обычных пользователей. `GRANT … TO authenticated` упадёт.
4. **Расширения `pg_graphql`, `pgsodium`, `pg_net`, `vault` недоступны** или требуют отдельной активации, которой нет.
5. **Триггеры/функции схемы `realtime`, `storage`, `vault`** ссылаются на отсутствующие в Yandex объекты Supabase Realtime/Storage.
6. **JWKS-claim accessor**: функции вида `auth.jwt()`, `auth.email()` читают `current_setting('request.jwt.claims', true)`, которое выставляет PostgREST. У нас в Yandex PostgREST не предполагается → эти функции либо пустые, либо ломаются.
7. **`schema_migrations` и служебные таблицы Supabase** (`supabase_migrations.*`) — не нужны.
8. **Owner/grant-конфликты**: дамп содержит `ALTER TABLE … OWNER TO supabase_admin` — этой роли в Yandex нет.
9. **publication `supabase_realtime`** — `ALTER PUBLICATION supabase_realtime ADD TABLE …` упадёт, т.к. publication отсутствует.
10. **Расширения требуют CREATE EXTENSION в нужной схеме** (`extensions.*` в Supabase) — мы либо создаём в `public`, либо чистим путь.

**Вывод:** в Yandex накатываются **только** наши user-миграции (`supabase/migrations/000000000000{01-12}*.sql`) и **только** после редактирования: убрать `auth.users` FK, убрать или переписать RLS, заменить `auth.uid()`, выкинуть лишние extensions. `supabase/schemas/prod.sql` — справочник, не run-once script.

---

## 12. Скрипты с Supabase-зависимостями

| Скрипт | Что использует | Действие |
|---|---|---|
| [scripts/cutover/verify_rowcounts.mjs](../../scripts/cutover/verify_rowcounts.mjs) | psql через Docker, сравнивает 44 таблицы между двумя БД | адаптировать: убрать `auth.identities` (или мапнуть в `public.users`), сравнить старый prod (Supabase) ↔ новый Yandex |
| [scripts/smoke/go-bff.mjs](../../scripts/smoke/go-bff.mjs) | `@supabase/supabase-js` для логина | заменить на наш `POST /api/v1/auth/login`, как только он появится |
| [scripts/dual-run/positions-with-costs.mjs](../../scripts/dual-run/positions-with-costs.mjs) | `SUPABASE_SERVICE_ROLE_KEY` для RPC | после миграции сравнивает Supabase ↔ Go (на время cutover), потом архивировать |
| `scripts/archive/*.cjs` (~20 файлов) | `@supabase/supabase-js`, `supabase.auth.admin.*` | архив, не на пути cutover. Если понадобятся (reset-password, list-users) — переписать через Go-эндпоинты |

---

## 13. Migration backlog (последовательность задач)

Этапность от меньшего риска к большему. Внутри каждого этапа задачи можно идти параллельно, между этапами — нельзя.

### Этап 0 — Подготовка (no-op для текущего prod)
1. Создать Yandex Managed PostgreSQL cluster: версия 17, session-pool endpoint порт 5432, SSL required.
2. Решить, как делать почту (forgot-password): SES от Yandex Cloud или SMTP-релей. Завести креды.
3. Подготовить генератор JWT-ключа (RSA-2048 или ECDSA P-256) и хранилище (Yandex Lockbox / env var).

### Этап 1 — Чистая SQL-схема под Yandex
4. Из `supabase/migrations/000…1` выкинуть `CREATE EXTENSION pg_graphql/pgsodium/pg_net/vault`.
5. В `000…3 (FKs)` — все 9 ссылок `REFERENCES auth.users(id)` → `REFERENCES public.users(id)`.
6. В `000…5 (functions)` — добавить параметр `p_user_id` или заменить `auth.uid()` на `current_setting('app.user_id', true)::uuid` в 6 функциях.
7. В `000…8 (RLS)` — решить: **рекомендуется удалить все 40 политик целиком**, доверившись авторизации в Go BFF (он уже это делает, RLS дублирует логику). Альтернатива — переписать политики на `current_setting('app.user_id')`.
8. Прогнать собранную схему в локальный pg17 (docker) → убедиться, что нет ошибок.

### Этап 2 — Свой auth-сервис в Go BFF
9. Добавить таблицу `public.password_credentials` (или колонки `password_hash`, `password_updated_at` в `public.users`).
10. Реализовать `POST /api/v1/auth/{register,login,logout,refresh,forgot-password,reset-password}` и `GET /.well-known/jwks.json` в Go.
11. Завести таблицы `public.refresh_tokens`, `public.password_reset_tokens` (TTL, single-use).
12. Сделать issuer = `${OUR_AUTH_ISSUER}`, поменять `SUPABASE_JWT_ISSUER` на наш домен в `.env` (Supabase JWT'ы перестанут валидироваться — это последний шаг cutover).

### Этап 3 — Доукомплектовать Go BFF
13. Реализовать `POST /api/v1/timeline/iterations` (создание итерации) — закрыть write-path.
14. Подтвердить контракт `POST /api/v1/imports/boq` ↔ RPC `bulk_import_client_position_boq`, при необходимости — добить.
15. Подтвердить контракт `POST /api/v1/tenders/{id}/versions/transfer` ↔ RPC `clone_tender_as_new_version + execute_version_transfer`, при необходимости — добить эндпоинт для `clone`.
16. Перевести [src/pages/PositionItems/hooks/useAuditRollback.ts](../../src/pages/PositionItems/hooks/useAuditRollback.ts) с `supabaseWithAudit.ts` на Go-эндпоинты (`PATCH/DELETE /api/v1/items/{id}`).
17. Удалить [src/lib/supabaseWithAudit.ts](../../src/lib/supabaseWithAudit.ts) и RPC `*_boq_item_with_audit` из БД.

### Этап 4 — Свой Auth SDK на фронте
18. Создать `src/lib/auth/` с собственным провайдером: `signIn`, `signUp`, `signOut`, `getSession`, `onAuthStateChange`, `resetPassword`, `updateUser`. Хранение в `localStorage`, auto-refresh через `setTimeout` перед `exp`.
19. Заменить `supabase.auth.*` во всех 4 страницах `src/pages/Auth/*` на новый провайдер.
20. Заменить `supabase.auth.getSession` в [src/lib/api/client.ts:36-39](../../src/lib/api/client.ts#L36-L39) на новый `getAccessToken()`.
21. Перенести `AuthContext` на новый провайдер.
22. Удалить SDK-импорт `@supabase/supabase-js` из `src/lib/supabase/client.ts` — но клиент пока оставить как заглушку для legacy fallback-веток.

### Этап 5 — Миграция данных
23. Выгрузить из Supabase: `auth.users` (id, email, encrypted_password, created_at, last_sign_in_at), `public.*` всё.
24. В Yandex: `INSERT` users в `public.users` (положить `encrypted_password` в новую колонку `password_hash` — bcrypt-совместимо со Supabase).
25. Перенести `public.*` через `pg_dump --data-only --schema=public` → `psql` на Yandex.
26. Прогнать [scripts/cutover/verify_rowcounts.mjs](../../scripts/cutover/verify_rowcounts.mjs) в режиме «Supabase vs Yandex».
27. Прогнать smoke и dual-run, сверить ключевые сценарии.

### Этап 6 — Cutover
28. В читать-онли режим перевести Supabase (как сейчас старый prod).
29. Финальный delta-sync (`auth.users.last_sign_in_at`, новые `public.*`-строки за окно).
30. Перенаправить Go BFF: `DATABASE_URL`, `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` → наши.
31. Передеплоить фронт (новый `.env` без `VITE_SUPABASE_*`).
32. Гасить Supabase-проект.

### Этап 7 — Cleanup
33. Удалить `@supabase/supabase-js` из `package.json`.
34. Удалить `src/lib/supabase/client.ts`, переписать `src/lib/supabase/types.ts` → `src/lib/types/` (домен-агностичный).
35. Удалить `else { supabase.from(...) }` ветки во всех `src/lib/api/*.ts`.
36. Удалить `featureFlags.ts::isGoEnabled` (теперь всегда true).
37. Удалить или архивировать `scripts/dual-run/` и `scripts/archive/`.
38. Из `.env.example` снести `VITE_SUPABASE_*` и `SUPABASE_SERVICE_ROLE_KEY`.
39. Обновить `CLAUDE.md` и `README.md`: убрать упоминания Supabase Auth и Session Pooler.

---

## 14. Проверка корректности этого отчёта (verification)

Когда выполняется задание этого отчёта, никаких изменений в коде/БД делать не надо. Отчёт считается принятым, когда:

1. По таблице в разделе 1 пользователь подтверждает приоритеты и риски.
2. По разделу 8 пользователь подтверждает список «дырок» в Go BFF.
3. По разделу 13 пользователь утверждает порядок этапов (особенно 5↔6 cutover).
4. Найденные расхождения с реальностью (если будут) правятся прямо в этом документе.

Никаких автотестов на этот документ не запускается — он живёт как актуальный snapshot до начала Этапа 1.
