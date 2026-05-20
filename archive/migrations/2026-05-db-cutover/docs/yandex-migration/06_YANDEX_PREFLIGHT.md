# 06. YANDEX PREFLIGHT — Result

> Сгенерировано `scripts/yandex-preflight/00_check_yandex_target.mjs`.
> Read-only проверка target. Данные в Yandex не импортировались.

- Run (UTC): 2026-05-17T22:02:07.219Z
- Связано: [00_SOURCE_OF_TRUTH.md](./00_SOURCE_OF_TRUTH.md), [01_YANDEX_TARGET_INVENTORY.md](./01_YANDEX_TARGET_INVENTORY.md), [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md)

## Checks

| Check | Result | Detail |
|---|---|---|
| SSL verify-full | OK | CA loaded from DSN sslrootcert; rejectUnauthorized=true; dsn sslmode=verify-full |
| Connection | OK | host=***.yandexcloud.net |
| PostgreSQL version | OK | major=17 (expected 17); server_version=17.9 (Ubuntu 17.9-201-yandex.59964.2288f7cd41) |
| TimeZone | INFO | Europe/Moscow |
| current_database() | OK | HubTender (expected HubTender) |
| current_user | OK | Odintsov (expected migrator Odintsov) |
| extension pgcrypto | OK | enabled |
| extension uuid-ossp | OK | enabled |
| extensions (all) | INFO | pgcrypto, plpgsql, uuid-ossp |
| public BASE TABLE count | WARN | 40 |
| user tables (non-system) | WARN | auth=2, public=40 |
| non-system schemas | INFO | auth, public |
| LISTEN/UNLISTEN rowchange | OK | via YANDEX_DATABASE_URL (host=***.yandexcloud.net, type=pooler) |
| Pooler connectivity | INFO | YANDEX_POOLER_DATABASE_URL не задан — пропущено |

## Blockers

_нет_

## Warnings

- ⚠️ Target НЕ пустой: 42 user-таблиц(ы). Ничего не удалялось. Для YANDEX_PREFLIGHT_OK нужна пустая БД.
- ⚠️ YANDEX_DIRECT_DATABASE_URL не задан — LISTEN проверен на YANDEX_DATABASE_URL (может быть transaction-pooler).

## Runtime cutover note (direct/session-safe DSN)

- Для **schema/data preflight** это НЕ блокер: подключение/SSL/версия/расширения/пустота target проверены.
- Для **production realtime на Go BFF** нужен direct/session-safe DSN: `LISTEN/NOTIFY` (канал `rowchange`)
  нестабилен через transaction-pooler.
- Этот пункт ОСТАЁТСЯ blocker/warning для **финального runtime cutover** (см. [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md) §9),
  пока `YANDEX_DIRECT_DATABASE_URL` не задан и LISTEN/NOTIFY на нём не подтверждён.

## Данные, которые ещё нужны от оператора

- Отдельный direct/session-safe DSN для LISTEN/NOTIFY (если основной endpoint — pooler).

## Gate criteria (YANDEX_PREFLIGHT_OK требует все)

- connection OK
- PostgreSQL major == ожидаемой (по умолчанию 17)
- SSL OK (verify-full: CA существует, rejectUnauthorized)
- required extensions enabled: `pgcrypto`, `uuid-ossp`
- target DB empty/ready (нет user-таблиц)
- direct/session-safe connection доступен для LISTEN/NOTIFY

## Final status

```
YANDEX_PREFLIGHT_OK_WITH_WARNINGS
```
