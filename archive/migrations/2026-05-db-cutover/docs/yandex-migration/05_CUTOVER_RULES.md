# 05. CUTOVER RULES — правила и stop-conditions

> Жёсткие правила финального переключения PROD Supabase → Yandex Managed PostgreSQL.
> В этом промте ничего не переключается.

Связано: [00_SOURCE_OF_TRUTH.md](./00_SOURCE_OF_TRUTH.md), [02_PROD_TO_YANDEX_PLAN.md](./02_PROD_TO_YANDEX_PLAN.md) (Stage 9), [04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md).

## 1. Запрет OLD как source

Yandex-миграция **не должна** использовать `OLD_SUPABASE_DB_URL` (проект `wkywhjljrhewfpedbjzx`).
Любой Yandex-export/verify, читающий из OLD, — ошибка, процесс останавливается.

## 2. Единственный source

Source — **только `PROD_SUPABASE_DB_URL`** (проект `ocauafggjrqvopxjihas`).

## 3. Production cutover requires

Перед production-cutover обязательно:

- PROD Supabase backup / restore point;
- Yandex backup / restore point (snapshot + PITR, если доступен);
- схема применена на Yandex (cleaned schema, см. [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md));
- расширения включены в Yandex-кластере (`pgcrypto` / `uuid-ossp`), не через `CREATE EXTENSION`;
- Yandex verify пройден (см. §6).

## 4. No destructive import without two-key guard

Никакого деструктивного импорта/очистки без двойной защиты:

- env-флаг;
- CLI-флаг;
- явный `--confirm`.

(Паттерн прототипа — `scripts/old-to-prod`: `ALLOW_CLEAN_*` + `--clean-*` + `--confirm`.)

## 5. Example future guards

Примеры будущих guard'ов (имена ориентировочные, реализуются в `scripts/prod-to-yandex/`):

- `ALLOW_CLEAN_YANDEX=true`
- `--clean-yandex`
- `--confirm`
- `ALLOW_AUTH_IMPORT=true`

## 6. No final DATABASE_URL switch until

Финальная смена backend `DATABASE_URL` → Yandex **запрещена** до выполнения всех:

- Yandex **VERIFY_OK** (row counts / checksums / FK);
- Yandex **AUTH_VERIFY_OK** (password hashes byte-to-byte);
- **Go BFF Yandex verification OK** (health/db, эндпоинты, `LISTEN/NOTIFY`).

## 7. Rollback

- **До финального switch:** rollback = просто продолжать работать на PROD Supabase (ничего не трогали).
- **После switch:** rollback = вернуть `DATABASE_URL` на PROD Supabase DSN.
- **Если Yandex уже принял записи после switch:** простого отката DSN недостаточно — требуется
  data reconciliation (сверка/перенос дельты Yandex → PROD до повторной попытки).

## 8. Runtime

- Frontend **никогда** не подключается к Yandex DB напрямую.
- **Go BFF — единственный runtime-клиент БД.**

## 9. Realtime

- Go realtime-listener должен использовать **direct / session-safe** соединение,
  **не transaction-pooler** (transaction-pooler ломает `LISTEN/NOTIFY`).
- Канал `rowchange` и pg_notify-триггеры должны быть сохранены (см. [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) §8).

## 10. Stop conditions

Немедленная остановка cutover при любом из:

- row count mismatch;
- checksum mismatch;
- FK / orphan errors;
- password hash mismatch;
- login smoke failure;
- Go BFF health / db failure;
- `LISTEN/NOTIFY` failure;
- missing extensions (`pgcrypto` / `uuid-ossp`).
