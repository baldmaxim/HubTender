# 01. YANDEX TARGET INVENTORY — Operator Checklist

> **This document supersedes `docs/yandex-migration/YANDEX_TARGET_INVENTORY.md`.**
> **Do not modify the old unnumbered document in this task.**
>
> Канонический нумерованный inventory параметров Yandex Managed PostgreSQL, которые должен
> предоставить оператор кластера **до** активации миграции. Реальные значения собираются в
> Lockbox / Vault / secret manager — **не в git**. Здесь только перечень полей и правил.

Связано: [00_SOURCE_OF_TRUTH.md](./00_SOURCE_OF_TRUTH.md), [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md).

## 1. Cluster identity

| Поле | Что предоставить | Примечание |
|---|---|---|
| Yandex cloud / folder | ID облака и каталога | — |
| Cluster name | Имя кластера | — |
| Cluster id | `mdb...` идентификатор | — |
| Region / zone(s) | Регион и зоны доступности | Для HA — несколько зон |
| PostgreSQL major version | Мажорная версия PG | **Должна быть совместима с PROD Supabase — PostgreSQL 17** |
| Совместимость версии | Подтвердить `SELECT version();` после подключения | Допустимо 17.x; ниже 17 — downgrade, требует отдельного решения |

## 2. Connection

| Поле | Что предоставить | Примечание |
|---|---|---|
| Master host / FQDN | FQDN мастера | `rc1a-xxxx.mdb.yandexcloud.net` |
| Read/Write host / FQDN | Если отличается от master | Для разделения R/W |
| Direct host / FQDN | Прямое подключение (если есть) | Нужен для `LISTEN/NOTIFY` (см. §5) |
| Pooler host / FQDN | Endpoint пулера (если есть) | Обычно отдельный FQDN/порт |
| Direct port | Порт прямого подключения | Обычно `5432` |
| Pooler port | Порт пулера | Обычно `6432` |
| Database name | Имя целевой БД | напр. `hubtender_prod` |
| Migration user | Имя миграционного пользователя | См. §3 |
| Runtime app user | Имя runtime-пользователя | См. §3 |
| SSL mode | Ожидается `verify-full` | Не `prefer`/`require` для runtime |
| sslrootcert path | Путь к CA-файлу на migration/runtime host | → переменная `YANDEX_SSL_ROOT_CERT` |
| Yandex root certificate | Источник Yandex CA root cert | Скачивается из Yandex docs/console |
| Public / private access | Режим сетевого доступа | private (VPC) рекомендуется |
| VPC / subnet / security groups | ID VPC, subnet, SG / allowlist CIDR | — |
| Bastion / jump host | Если кластер private-only | Отдельные SSH-креды для миграции |

## 3. Users

| Пользователь | Привилегии | Использование |
|---|---|---|
| `migrator` | `CREATE` / DDL (создание схем, таблиц, FK, триггеров) | Только фаза миграции; отключается/удаляется после успешного cutover |
| `hubtender_app` | `SELECT, INSERT, UPDATE, DELETE` на прикладных схемах; **без** `CREATE/DROP/TRUNCATE` | Runtime Go BFF после миграции (defence-in-depth) |

- Пароли обоих пользователей хранятся **только** в Lockbox / Vault / secret manager.
- Пароли **не коммитятся** в git, не пишутся в `.env` на shared host, не логируются.
- Ротация паролей — до активации.

## 4. Extensions

| Поле | Что предоставить |
|---|---|
| Enabled extensions | Список фактически включённых расширений в целевой БД (`SELECT extname FROM pg_extension;`) |

Кандидаты обязательных расширений (зависит от cleaned schema — см. [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md)):

- **`pgcrypto`** — если cleaned schema использует `gen_random_uuid()` (в текущем `prod.sql` ~22 вхождения).
- **`uuid-ossp`** — если cleaned schema использует `uuid_generate_v4()` (в текущем `prod.sql` ~19 вхождений).

> **Note:** расширения должны включаться через настройки Yandex Managed PostgreSQL
> (console / CLI / API / cluster settings), **а не** через `CREATE EXTENSION` в migration SQL.
> Cleaned schema не должна содержать `CREATE EXTENSION` и schema-qualified вызовов вида
> `extensions.uuid_generate_v4()`.

## 5. Realtime (LISTEN/NOTIFY)

| Поле | Что предоставить | Примечание |
|---|---|---|
| Direct/session-safe connection | Доступен ли стабильный direct/session endpoint | Обязателен для realtime |
| Pooler mode | `transaction` или `session` | Transaction-pooler **ломает** `LISTEN/NOTIFY` |
| Стабильное соединение для `LISTEN rowchange` | Подтвердить, что Go BFF realtime-listener сможет держать постоянное соединение | Канал — `rowchange` |
| Сохранность pg_notify-триггеров | Подтвердить план переноса триггеров | Триггеры на `tenders`, `notifications`, `boq_items`, `client_positions`, `cost_redistribution_results`, `construction_cost_volumes` через `public.notify_row_change()` — **должны быть сохранены** |

## 6. Backup

| Поле | Что предоставить |
|---|---|
| Snapshot enabled | Включены ли регулярные снапшоты (daily) |
| PITR enabled | Включён ли Point-in-Time Recovery (если доступен) |
| Retention period | Период хранения бэкапов (рекомендуется ≥ 7 дней) |
| Restore rehearsal status | Проводилась ли репетиция восстановления |
| Maintenance window | Окно обслуживания Yandex (вне бизнес-пика) |

## 7. Capacity

| Поле | Требование |
|---|---|
| Storage | ≥ объём данных PROD Supabase × 2 (load + WAL headroom) |
| Connection limit | ≥ пул Go BFF + миграционный пул |
| Expected migration batch size | Согласовать размер батча импорта (прототип — `scripts/old-to-prod`) |
| Expected maintenance window | Окно, в которое допустим cutover |

## 8. What NOT to do until activation

Жёсткие запреты до получения сигнала активации (см. [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md)):

- ❌ Не менять backend `DATABASE_URL`.
- ❌ Не менять frontend env.
- ❌ Не импортировать данные в Yandex.
- ❌ Не запускать Yandex-скрипты (`scripts/prod-to-yandex/` ещё не существует).
- ❌ Не указывать Go BFF на Yandex.
- ❌ Не коммитить Yandex DSN/пароли/сертификаты в репозиторий.
- ❌ Не менять старый `docs/yandex-migration/YANDEX_TARGET_INVENTORY.md`.
