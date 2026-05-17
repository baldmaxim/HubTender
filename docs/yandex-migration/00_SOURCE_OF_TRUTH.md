# 00. SOURCE OF TRUTH — Yandex Migration Foundation

> Документ фиксирует, какой источник данных является единственным валидным для будущей
> миграции на Yandex Managed Service for PostgreSQL. Миграция в этом промте **не запускается**.

## 1. OLD → PROD strict cutover: COMPLETED

Этап миграции **OLD Supabase → PROD Supabase** завершён и подтверждён строгими
gate-артефактами. Все gate-статусы зелёные:

| Gate | Артефакт | Статус |
|---|---|---|
| Pre-flight готовность PROD | [../old-to-prod/PREPARE_REPORT.md](../old-to-prod/PREPARE_REPORT.md) | **READY** |
| Целостность данных (row counts / checksums / FK) | [../old-to-prod/VERIFY_RESULT.md](../old-to-prod/VERIFY_RESULT.md) | **VERIFY_OK** |
| Целостность auth (users / identities / password hashes) | [../old-to-prod/AUTH_VERIFY_RESULT.md](../old-to-prod/AUTH_VERIFY_RESULT.md) | **AUTH_VERIFY_OK** |
| Ремонт GoTrue token-колонок (NULL → '') | [../old-to-prod/AUTH_REPAIR_RESULT.md](../old-to-prod/AUTH_REPAIR_RESULT.md) | **REPAIR_OK** |
| Smoke-логин по реальным кредам | [../old-to-prod/SMOKE_CREDENTIALS_CHECK.md](../old-to-prod/SMOKE_CREDENTIALS_CHECK.md) | **SMOKE_CREDENTIALS_OK** |
| Go BFF против PROD + готовность к Yandex | [../old-to-prod/PROD_GO_BFF_VERIFICATION.md](../old-to-prod/PROD_GO_BFF_VERIFICATION.md) | **READY_FOR_YANDEX_MIGRATION** |

Совокупный вывод: **OLD → PROD strict cutover completed**. PROD Supabase признан стабильным
и подтверждён Go BFF, поэтому открыта подготовка следующего этапа — миграции на Yandex.

## 2. Единственный валидный source для Yandex migration

| Проект | Ref | Роль в Yandex-миграции |
|---|---|---|
| **PROD Supabase** | `ocauafggjrqvopxjihas` | ✅ **Единственный валидный source** данных и auth для миграции в Yandex |
| **OLD Supabase** | `wkywhjljrhewfpedbjzx` | 🗄️ Архив / read-only historical source. **НЕ использовать** как source для Yandex |

Жёсткие правила:

- **`OLD_SUPABASE_DB_URL` запрещён** как source для Yandex migration. Любой экспорт/верификация
  Yandex-этапа, читающий из `OLD_SUPABASE_DB_URL`, считается ошибкой и должен быть остановлен.
- **`PROD_SUPABASE_DB_URL`** — будущий (и единственный) source для экспорта в Yandex.
- **`YANDEX_DATABASE_URL` / `PROD_TARGET_DB_URL`** — будущий target. На данный момент **не задан**
  и в репозиторий не коммитится.

## 3. Yandex target: Managed PostgreSQL, не YDB

- Целевая СУБД — **Yandex Managed Service for PostgreSQL** (managed Postgres-кластер).
- **YDB для этого проекта не используется.** Схема, расширения, `LISTEN/NOTIFY`, FK и bcrypt-логика
  рассчитаны на стандартный PostgreSQL; YDB несовместим с этой моделью.
- Целевая major-версия PostgreSQL должна быть совместима с PROD Supabase — **PostgreSQL 17**
  (PROD Supabase: 17.x). Подробности — [01_YANDEX_TARGET_INVENTORY.md](./01_YANDEX_TARGET_INVENTORY.md).

## 4. Env-переменные: где можно и где нельзя

> Реальные значения хранятся только в Lockbox / Vault / secret manager и **никогда в git**.
> Здесь — только имена переменных и правила использования.

| Переменная | Назначение | Можно использовать | НЕЛЬЗЯ использовать |
|---|---|---|---|
| `OLD_SUPABASE_DB_URL` | DSN старого Supabase (`wkywhjljrhewfpedbjzx`) | Только исторический архив / разовые ретро-сверки OLD↔PROD прошлого этапа | ❌ Как source для Yandex migration (любой Yandex export/verify) |
| `PROD_SUPABASE_DB_URL` | DSN PROD Supabase (`ocauafggjrqvopxjihas`) | ✅ Единственный source для будущего экспорта PROD → Yandex | Не использовать как target; не писать в него на Yandex-этапе |
| `YANDEX_DATABASE_URL` | Будущий DSN Yandex Managed PG (target) | После активации — target для import/verify Yandex-этапа | До активации — не задаётся, не коммитится, Go BFF на него не указывает |
| `YANDEX_SSL_ROOT_CERT` | Путь к Yandex root CA (для `sslmode=verify-full`) | После активации — TLS-верификация подключения к Yandex | До активации — не требуется |
| `DATABASE_URL` | Runtime-DSN Go BFF (сейчас → PROD Supabase) | Сейчас указывает на PROD Supabase | ❌ **Не менять в этом промте.** Переключение на Yandex — отдельный защищённый cutover (см. [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md)) |

## 5. Связанные документы

- [01_YANDEX_TARGET_INVENTORY.md](./01_YANDEX_TARGET_INVENTORY.md) — checklist параметров кластера от оператора
- [02_PROD_TO_YANDEX_PLAN.md](./02_PROD_TO_YANDEX_PLAN.md) — 10 этапов миграции
- [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) — стратегия схемы (без Supabase-internal)
- [04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md) — замена Supabase Auth на app-auth в Go
- [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md) — правила и stop-conditions финального переключения
