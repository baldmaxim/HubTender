# 29 — App-Auth DB-Layer Plan (Phase 6 MVP)

> Scope of THIS step: только DB-слой Phase 6 app-auth. Никаких изменений во фронте,
> Go BFF, env-секретах, деплое или Yandex-данных. Реальный apply — отдельным
> подтверждением пользователя.

## Контекст

После cutover на Yandex Managed PostgreSQL (2026-05-18) и фронт-деплоя
(2026-05-21) runtime выглядит так:

```
Frontend → Supabase Auth bridge (только JWT) → Go BFF → Yandex PostgreSQL
```

Полный план Phase 6 — в [22_APP_AUTH_MIGRATION_PLAN.md](22_APP_AUTH_MIGRATION_PLAN.md)
и [docs/NEXT_PHASE_APP_AUTH.md](../NEXT_PHASE_APP_AUTH.md). Текущий шаг —
самый первый: подготовить хранилище для рефреш-токенов, токенов сброса пароля
и аудит-журнала, чтобы будущая работа над Go-эндпоинтами `/auth/v1/*` имела
куда писать.

## MVP-решение по паролям

**`auth.users.encrypted_password` остаётся источником истины** для bcrypt-хэшей.
Они уже импортированы байт-в-байт из PROD ([db/yandex/sql/01_auth_compat_or_app_auth.sql:76](../../db/yandex/sql/01_auth_compat_or_app_auth.sql#L76))
и проверены. Никакого `app_auth.password_credentials` на этом шаге **НЕ** создаём,
никакого rehash. Перенос в отдельную таблицу — следующая итерация.

## Что добавляется

Один файл: [db/yandex/incremental/2026_05_app_auth_runtime.sql](../../db/yandex/incremental/2026_05_app_auth_runtime.sql).

### `schema app_auth`
Новая схема под рантайм-стейт app-auth.

### `app_auth.refresh_tokens`
Состояние ротации opaque refresh-токенов.

| Column            | Type        | Notes |
|-------------------|-------------|-------|
| `id`              | uuid PK     | `gen_random_uuid()` |
| `user_id`         | uuid NOT NULL | FK `auth.users(id)` ON DELETE CASCADE |
| `token_hash`      | text NOT NULL UNIQUE | SHA-256 от plaintext-токена; plaintext НЕ хранится |
| `token_family_id` | uuid NOT NULL | группа ротации — reuse-detection отзывает всю семью |
| `issued_at`       | timestamptz NOT NULL DEFAULT now() | |
| `expires_at`      | timestamptz NOT NULL | |
| `revoked_at`      | timestamptz NULL | |
| `replaced_by`     | uuid NULL | id наследника по цепочке ротации (FK на app-уровне, не БД) |
| `user_agent`      | text NULL | |
| `ip_address`      | inet NULL | |
| `created_at`      | timestamptz NOT NULL DEFAULT now() | |

Индексы: `user_id`, `token_family_id`, `expires_at`, `revoked_at`.

### `app_auth.password_reset_tokens`
Однократно используемые токены сброса пароля.

| Column         | Type        | Notes |
|----------------|-------------|-------|
| `id`           | uuid PK     | `gen_random_uuid()` |
| `user_id`      | uuid NOT NULL | FK `auth.users(id)` ON DELETE CASCADE |
| `token_hash`   | text NOT NULL UNIQUE | SHA-256 от plaintext reset-токена |
| `requested_at` | timestamptz NOT NULL DEFAULT now() | |
| `expires_at`   | timestamptz NOT NULL | |
| `used_at`      | timestamptz NULL | |
| `user_agent`   | text NULL | |
| `ip_address`   | inet NULL | |

Индексы: `user_id`, `expires_at`, `used_at`.

### `app_auth.auth_events`
Append-only аудит-журнал.

| Column       | Type        | Notes |
|--------------|-------------|-------|
| `id`         | uuid PK     | `gen_random_uuid()` |
| `user_id`    | uuid NULL   | FK `auth.users(id)` ON DELETE SET NULL |
| `event_type` | text NOT NULL | свободная строка (login_success, refresh_rotated, …) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `ip_address` | inet NULL | |
| `user_agent` | text NULL | |
| `metadata`   | jsonb NOT NULL DEFAULT `'{}'::jsonb` | plaintext-секреты сюда НЕ пишутся |

## Политика безопасности

- Plaintext refresh-токены **никогда** не сохраняются — только SHA-256.
- Plaintext reset-токены **никогда** не сохраняются — только SHA-256.
- Plaintext пароли **никогда** не сохраняются и не логируются.
- Хэши паролей живут в `auth.users.encrypted_password` (bcrypt, AS-IS из PROD).
- В `auth_events.metadata` нельзя писать токены/пароли (даже хэши).

## Запрещённые конструкции в SQL

Apply-скрипт делает forbidden-pattern scan до коннекта к БД. Любой матч — отказ:

- `CREATE EXTENSION`
- `CREATE ROLE`
- `ALTER ROLE`
- `ALTER SYSTEM`
- `session_replication_role`

Поэтому `gen_random_uuid()` берём из уже включённого на уровне Yandex-кластера
pgcrypto (как и в baseline `db/yandex/sql/03_tables.sql`), без `CREATE EXTENSION`.

## Как применять

### 1. Подготовка env (вручную)
```powershell
Copy-Item scripts/app-auth/.env.app-auth.example scripts/app-auth/.env.app-auth
# Заполнить YANDEX_DATABASE_URL и ALLOW_APPLY_APP_AUTH_SCHEMA=true
```

### 2. Dry-run (без БД)
```powershell
npm run app-auth:schema -- --dry-run
```
Печатает summary (CREATE SCHEMA / CREATE TABLE / CREATE INDEX / COMMENT ON),
прогоняет forbidden-pattern scan, пишет результат в
[30_APP_AUTH_SCHEMA_APPLY_RESULT.md](30_APP_AUTH_SCHEMA_APPLY_RESULT.md). К БД не подключается.

### 3. Реальный apply
```powershell
npm run app-auth:schema
```
Требует `ALLOW_APPLY_APP_AUTH_SCHEMA=true`. Выполняет SQL в одной транзакции
(BEGIN/COMMIT, rollback при любой ошибке).

### 4. Верификация
```powershell
npm run app-auth:check-schema
```
Read-only — проверяет схему, таблицы, колонки (имя/тип/nullability), индексы
и `auth.users.encrypted_password`. Пишет
[31_APP_AUTH_SCHEMA_VERIFY_RESULT.md](31_APP_AUTH_SCHEMA_VERIFY_RESULT.md).
Exit 0 = всё OK, exit 1 = есть MISSING / TYPE_MISMATCH.

## Что НЕ делается на этом шаге

- ❌ изменения фронта (`src/**`) и Go BFF (`backend/**`)
- ❌ модификация Supabase Auth bridge / удаление Supabase Auth
- ❌ создание `app_auth.password_credentials` (отложено до следующей итерации)
- ❌ rehash / миграция bcrypt-хэшей
- ❌ изменения в `db/yandex/sql/` baseline (неприкосновенен)
- ❌ деплой / push / создание PR
- ❌ запуск `import` / `clean` / `repair` против Yandex
- ❌ реальный apply без отдельного подтверждения пользователя

## Связанные файлы

- SQL: [db/yandex/incremental/2026_05_app_auth_runtime.sql](../../db/yandex/incremental/2026_05_app_auth_runtime.sql)
- Apply: [scripts/app-auth/01_apply_app_auth_schema.mjs](../../scripts/app-auth/01_apply_app_auth_schema.mjs)
- Check: [scripts/app-auth/00_check_app_auth_schema.mjs](../../scripts/app-auth/00_check_app_auth_schema.mjs)
- Env template: [scripts/app-auth/.env.app-auth.example](../../scripts/app-auth/.env.app-auth.example)
- Результат apply: [30_APP_AUTH_SCHEMA_APPLY_RESULT.md](30_APP_AUTH_SCHEMA_APPLY_RESULT.md) (создаётся скриптом)
- Результат verify: [31_APP_AUTH_SCHEMA_VERIFY_RESULT.md](31_APP_AUTH_SCHEMA_VERIFY_RESULT.md) (создаётся скриптом)
- Полный план Phase 6: [22_APP_AUTH_MIGRATION_PLAN.md](22_APP_AUTH_MIGRATION_PLAN.md), [../NEXT_PHASE_APP_AUTH.md](../NEXT_PHASE_APP_AUTH.md)
- Token issuer scaffold (уже в репо): [backend/internal/auth/issuer.go](../../backend/internal/auth/issuer.go)
- Auth bridge таблица: [db/yandex/sql/01_auth_compat_or_app_auth.sql](../../db/yandex/sql/01_auth_compat_or_app_auth.sql)
