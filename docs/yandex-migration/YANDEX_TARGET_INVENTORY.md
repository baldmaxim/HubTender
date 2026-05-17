# Yandex Managed PostgreSQL — Target Inventory (preparatory)

> Этот документ собран **до** подключения Yandex Managed PostgreSQL к проекту HubTender. Yandex-кластер создан, но в runtime не используется. Документ фиксирует список параметров и pre-flight-проверок, которые понадобятся **после** того как PROD Supabase будет признан стабильным и Go BFF подтверждён.

## 0. Status: NOT YET ACTIVE

| | |
|---|---|
| Yandex cluster created | ✅ |
| Yandex used as runtime target | ❌ — текущая prod-БД остаётся `ocauafggjrqvopxjihas` (Supabase) |
| `DATABASE_URL` указывает на Yandex | ❌ — без изменений до активации |
| `.env.example` содержит Yandex-переменные | ❌ — менять не будем до активации |
| Frontend/backend подключены к Yandex | ❌ |
| Migration scripts запущены против Yandex | ❌ |

**До активации НИКАКИХ изменений** в `DATABASE_URL`, `.env.example`, `db/yandex/sql/`, `backend/`, `src/` не делать.

## 1. Activation gate (когда Yandex становится target)

Yandex активируется как target миграции **только** после того, как файл [`docs/old-to-prod/PROD_GO_BFF_VERIFICATION.md`](../old-to-prod/PROD_GO_BFF_VERIFICATION.md) (Промт 1.7) будет иметь:

```
Final status: READY_FOR_YANDEX_MIGRATION
```

До этого статуса:
- продолжаем работать на PROD Supabase (`ocauafggjrqvopxjihas`)
- Yandex кластер служит только cold-target для будущей миграции
- любые connection-strings к Yandex остаются вне репозитория (никаких `.env`-комитов)

После статуса:
- запускается новый pipeline `db/yandex/...` / `scripts/prod-to-yandex/...` (будет создан отдельной задачей)
- Yandex принимает schema + data из PROD Supabase
- runtime-роуты Go BFF переключаются на Yandex

## 2. Required connection parameters (что собрать от Yandex)

Эти значения нужны для будущего `scripts/prod-to-yandex/`. Сейчас просто зафиксировать в защищённом хранилище (1Password / Yandex Lockbox / зашифрованный note) — **не в git**.

| Параметр | Где взять в Yandex Console | Назначение | Пример формата |
|---|---|---|---|
| **host / FQDN** | Cluster overview → Hosts → master FQDN | Подключение через psql/pgx | `rc1a-xxxxxxxx.mdb.yandexcloud.net` |
| **port** | Cluster overview → Hosts → Port | Обычно `6432` (pooler) или `5432` | `6432` |
| **database name** | Databases tab | Имя базы для приложения | `hubtender_prod` |
| **database user** (миграционный) | Users tab → создать отдельного `migrator` с `CREATE` грантами | Используется ТОЛЬКО для migration phase | `migrator` |
| **database user** (runtime) | Users tab → отдельный read/write user без `CREATE` | Используется Go BFF в runtime после миграции | `hubtender_app` |
| **password** (для обоих) | Yandex Console → Users → Reset password | Хранить только в Lockbox/.env (gitignored) | (rotation needed before activation) |
| **SSL root certificate** | https://storage.yandexcloud.net/cloud-certs/CA.pem (см. `docs.yandex.cloud`) | TLS verification для `sslmode=verify-full` | `~/.postgresql/root.crt` или explicit path |
| **PostgreSQL version** | Cluster overview → PostgreSQL version | Compatibility check vs Supabase (17.6) | `17` или `16` |
| **enabled extensions** | Databases → Extensions tab | Должны быть: `uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm` (если используется) | См. секцию 3 ниже |
| **public/private access** | Cluster overview → Network → Access | Определяет откуда можно подключиться | `private` (через VPC) рекомендуется |
| **VPC / Subnet / Security Group** | Cluster overview → Network | Какие CIDR/SG имеют доступ | Зависит от инфры |
| **Connection pool mode** | Cluster overview → Settings → `pooler_mode` | `transaction` (PgBouncer-style) vs `session` | Зависит от Go BFF — `session` нужен для prepared stmts |
| **maintenance_window** | Cluster overview → Maintenance | Когда Yandex может рестартнуть | Выбрать low-traffic окно |

### Connection string template (для будущего `PROD_TARGET_DB_URL`)

```
postgresql://migrator:<PASSWORD>@<FQDN>:<PORT>/<DBNAME>?sslmode=verify-full&sslrootcert=<PATH_TO_CA_PEM>
```

`PASSWORD` percent-encoded если есть спецсимволы.

## 3. Compatibility checklist (Yandex vs PROD Supabase)

PROD Supabase сейчас на **PostgreSQL 17.6** (`ocauafggjrqvopxjihas`). При выборе Yandex cluster важно совпадение по major version и набору расширений.

### 3.1. Версия PostgreSQL

| Источник | Версия |
|---|---|
| PROD Supabase | 17.6 |
| Yandex Managed PG | На момент написания: 17.x доступен в Yandex MDB. **Создать кластер на 17** (или хотя бы 16; 15 будет downgrade). |

Подтвердить через psql после подключения:
```sql
SELECT version();
```

### 3.2. Required extensions

PROD Supabase использует следующие расширения (по `01_SUPABASE_AUDIT.md` и `supabase/schemas/prod.sql`):

| Extension | Schema | Зачем | Yandex поддерживает |
|---|---|---|---|
| `uuid-ossp` | extensions/public | `uuid_generate_v4()` для PK | ✅ из коробки |
| `pgcrypto` | extensions/public | `gen_random_uuid()`, `digest()` для smoke-checksums | ✅ |
| `citext` | public | Case-insensitive emails / agg over text (`min(citext)`, `max(citext)`) | ✅ |
| `pg_trgm` | extensions | Если используется fuzzy-search (проверить grep по коду) | ✅ |
| `pg_stat_statements` | extensions | Observability | ✅ |
| (Supabase-specific) `pgsodium` / `supabase_vault` / `graphql` | extensions | **НЕ переносятся** — Supabase-only, у нас не используются | n/a (skip) |

При активации сверить `SELECT extname FROM pg_extension` на обеих сторонах.

### 3.3. Roles / privileges

PROD Supabase использует роли `authenticated`, `anon`, `service_role` (RLS). После миграции на Yandex:
- RLS остаётся на схеме, но `auth.uid()` нужно либо вырезать, либо подменить на `current_setting('app.user_id')::uuid` (см. 01_SUPABASE_AUDIT.md → row-level security blockers)
- Yandex не имеет ролей `authenticated`/`anon`/`service_role` — мигрировать роли НЕ нужно
- Создать в Yandex отдельных users: `migrator` (для миграции) + `hubtender_app` (для runtime Go BFF)

### 3.4. Schema differences

Готовый список нюансов для PROD Supabase → Yandex schema port — в [01_SUPABASE_AUDIT.md](./01_SUPABASE_AUDIT.md) (раздел "Main table: что зависит от Supabase"). Сюда не дублирую.

## 4. Network access (как добраться до Yandex)

Yandex Managed PG поддерживает два режима доступа:

| Режим | Use case | Pros | Cons |
|---|---|---|---|
| **Public** | Прямое подключение из любой точки интернета | Простое подключение для разработки | Шире attack surface; нужен IP allowlist |
| **Private (VPC)** | Только из internal Yandex VPC через subnet | Безопаснее; не требует IP allowlist | Нужен bastion/VPN для миграции с локальной машины |

**Рекомендация**: настроить **private + bastion** для миграции, или хотя бы public с **IP allowlist** на текущий миграционный host.

Из конкретных параметров зафиксировать:
- VPC ID
- Subnet ID (где сидит cluster)
- Security Group ID(s) — какие CIDR разрешены
- Bastion host (если используется) — отдельные SSH creds

## 5. Pre-flight checklist (до старта PROD Supabase → Yandex migration)

Когда придёт момент активации (после `READY_FOR_YANDEX_MIGRATION`), пройти этот checklist. **Сейчас ничего из него не запускаем** — только список для будущей работы.

### 5.1. Connectivity
- [ ] `pg_isready -h <FQDN> -p <PORT>` отвечает `accepting connections`
- [ ] `psql "postgresql://migrator:...@<FQDN>:<PORT>/<DBNAME>?sslmode=verify-full"` логинится
- [ ] Из миграционного host — TLS handshake успешен, `sslmode=verify-full` работает с указанным CA

### 5.2. Versions & extensions
- [ ] `SELECT version();` — major version совпадает с PROD Supabase (17.x)
- [ ] `SELECT extname FROM pg_extension;` содержит все нужные расширения из секции 3.2
- [ ] `citext` доступен (для `min/max(citext)` aggregates)
- [ ] `pgcrypto` доступен (для `gen_random_uuid()` если используется)

### 5.3. Permissions
- [ ] `migrator` имеет `CREATE` на target database
- [ ] `migrator` может создавать schemas (`CREATE SCHEMA`)
- [ ] `migrator` может создавать роли (если миграция включает CREATE ROLE) — обычно НЕ нужно
- [ ] `hubtender_app` имеет `SELECT,INSERT,UPDATE,DELETE` на нужных схемах
- [ ] `hubtender_app` НЕ имеет `CREATE/DROP` (defence in depth)

### 5.4. Capacity
- [ ] Storage size ≥ PROD Supabase data size × 2 (для safe load + WAL headroom)
- [ ] CPU/RAM достаточны для пика import (рекомендация — снять с PROD Supabase Dashboard → DB Stats)
- [ ] Connection limit ≥ `max_connections` Go BFF + миграционный pool

### 5.5. Reliability
- [ ] Backups настроены: daily snapshot + WAL archive
- [ ] Point-in-time recovery (PITR) включён, retention window ≥ 7 дней
- [ ] HA replica настроен (если бизнес требует) — синхронный vs асинхронный режим зафиксирован
- [ ] Maintenance window не пересекается с критическим bizn-окном (не пятница вечер)

### 5.6. Observability
- [ ] Yandex Monitoring metrics видны в Yandex Cloud Console
- [ ] Алерты: replication lag, disk usage, CPU>80%, connection saturation
- [ ] Логи PostgreSQL экспортируются куда-то (Yandex Cloud Logging, S3, или внешнее SIEM)
- [ ] `pg_stat_statements` включён и не сбрасывается рестартом

### 5.7. Security
- [ ] Public access выключен ИЛИ IP allowlist настроен (если public)
- [ ] Все пароли в Lockbox/Vault — НЕ в git и НЕ в plain `.env` на shared host
- [ ] `migrator` отключается / роль удаляется после успешной миграции (single-use)
- [ ] SSL enforced (`sslmode=verify-full` для runtime, не `prefer`)
- [ ] Yandex IAM/SQL access реквизиты розданы только нужным людям

### 5.8. Migration tooling readiness (отдельная задача после активации)
- [ ] `scripts/prod-to-yandex/` создан (зеркало `scripts/old-to-prod/`, с поправками на отсутствие Supabase Auth)
- [ ] `db/yandex/sql/` создан со schema DDL (без Supabase-specific extensions)
- [ ] RLS-политики переделаны под `current_setting('app.user_id')::uuid` (см. 01_SUPABASE_AUDIT.md)
- [ ] Smoke-test plan для Yandex (типа `09_smoke_go_bff.mjs`, но против Yandex target)
- [ ] Rollback plan: как откатиться на PROD Supabase при провале миграции (Go BFF flag → старый DSN)

## 6. What NOT to do until activation

Жёсткий список запретов до получения `READY_FOR_YANDEX_MIGRATION`:

- ❌ Не менять `DATABASE_URL` в любых `.env` файлах
- ❌ Не добавлять Yandex-переменные в `.env.example` (только когда будет реальный target)
- ❌ Не создавать `db/yandex/sql/` (структура придёт со схема-миграцией)
- ❌ Не подключать Yandex к `backend/` (Go BFF pgx pool) или `src/` (фронт)
- ❌ Не коммитить Yandex connection-strings/пароли в репозиторий
- ❌ Не запускать `scripts/prod-to-yandex/` (не существует на данный момент — и не должен до активации)
- ❌ Не модифицировать [01_SUPABASE_AUDIT.md](./01_SUPABASE_AUDIT.md) под Yandex-specific решения — он отражает текущую Supabase-реальность

## 7. References

- Yandex Managed PostgreSQL: https://yandex.cloud/en/docs/managed-postgresql/
- Yandex MDB SSL root cert: https://yandex.cloud/en/docs/managed-postgresql/operations/connect
- Current Supabase audit: [01_SUPABASE_AUDIT.md](./01_SUPABASE_AUDIT.md)
- PROD Supabase status / pre-cutover: [docs/old-to-prod/RUNBOOK.md](../old-to-prod/RUNBOOK.md)
- Activation gate: [docs/old-to-prod/PROD_GO_BFF_VERIFICATION.md](../old-to-prod/PROD_GO_BFF_VERIFICATION.md) (создаётся Промтом 1.7)
