# 02. PROD → YANDEX PLAN — 10 этапов

> Поэтапный план миграции PROD Supabase (`ocauafggjrqvopxjihas`) → Yandex Managed PostgreSQL.
> В этом промте план только описан; ничего не выполняется.

Source-of-truth этапа: только `PROD_SUPABASE_DB_URL` (см. [00_SOURCE_OF_TRUTH.md](./00_SOURCE_OF_TRUTH.md)).
Будущий pipeline — папка **`scripts/prod-to-yandex/`** (зеркало `scripts/old-to-prod/`,
с поправкой на отсутствие Supabase Auth). **В этом промте `scripts/prod-to-yandex/` НЕ создаётся.**

---

## Stage 1 — Build clean Yandex PostgreSQL schema

- **Goal:** получить чистую, deploy-готовую схему PostgreSQL без Supabase-internal объектов.
- **Input:** `supabase/migrations/`; [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md).
- **Output / gate:** будущая `db/yandex/sql/` (создаётся отдельной задачей, не сейчас); схема применяется на Yandex без ошибок.
- **Prototype:** —
- **Notes:** **не использовать `supabase/schemas/prod.sql` как deploy-source** (public-only dump, битые cross-schema FK `REFERENCES None.None(None)`, нет RLS/триггеров/auth). Источник истины — упорядоченные миграции. Расширения включаются в настройках кластера, не через `CREATE EXTENSION`.

## Stage 2 — Replace Supabase Auth with app-auth in Go

- **Goal:** заменить Supabase Auth (GoTrue) собственным auth в Go BFF.
- **Input:** `backend/internal/auth/` (password.go / issuer.go / keys.go), `backend/internal/middleware/auth.go`.
- **Output / gate:** Go auth-эндпоинты + JWT issuer + собственный JWKS; middleware переключён с Supabase JWKS на app JWKS.
- **Prototype:** —
- **Notes:** детали и список эндпоинтов — [04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md). Текущий пакет частично готов (bcrypt, JWT issuer, JWKS), HTTP-хендлеры/проводка в `main.go` отсутствуют.

## Stage 3 — Export PROD Supabase data

- **Goal:** консистентный read-only снапшот данных и auth из PROD Supabase.
- **Input:** `PROD_SUPABASE_DB_URL` (единственный валидный source).
- **Output / gate:** export manifest будущего `scripts/prod-to-yandex/` (NDJSON + manifest + auth_stats).
- **Prototype:** [`scripts/old-to-prod/04_export_old.mjs`](../../scripts/old-to-prod/04_export_old.mjs) (snapshot в одной `REPEATABLE READ READ ONLY` транзакции; pool-safe режим для тяжёлых таблиц).
- **Notes:** `OLD_SUPABASE_DB_URL` использовать **запрещено**. Source строго `PROD_SUPABASE_DB_URL`.

## Stage 4 — Import data to Yandex

- **Goal:** загрузить экспортированные данные в Yandex.
- **Input:** `YANDEX_DATABASE_URL` (target).
- **Output / gate:** импортированные данные в Yandex; resumable import state.
- **Prototype:** [`scripts/old-to-prod/06_import_prod.mjs`](../../scripts/old-to-prod/06_import_prod.mjs) (топологический порядок FK, временное отключение триггеров, two-key guard).
- **Notes:** деструктивный импорт только под two-key guard (env-флаг + CLI-флаг + `--confirm`) — см. [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md).

## Stage 5 — Preserve password login

- **Goal:** сохранить вход по старым паролям без сброса.
- **Input:** PROD Supabase `auth.users.encrypted_password` (bcrypt-хеши).
- **Output / gate:** заполненный app-auth password storage (`app_auth.password_credentials`) или auth-compat таблица.
- **Prototype:** auth-логика из [`scripts/old-to-prod/_auth.mjs`](../../scripts/old-to-prod/_auth.mjs) / [`08_verify_auth.mjs`](../../scripts/old-to-prod/08_verify_auth.mjs).
- **Notes:** bcrypt-хеши копируются **as-is**, не рехешируются; plaintext-паролей не существует; хеши не логируются. Подробности — [04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md).

## Stage 6 — Verify row counts, checksums, FK consistency

- **Goal:** доказать целостность данных на Yandex.
- **Input:** Yandex после импорта + export manifest PROD.
- **Output / gate:** **Yandex VERIFY_OK**.
- **Prototype:** [`scripts/old-to-prod/07_verify.mjs`](../../scripts/old-to-prod/07_verify.mjs) (строгое равенство row counts, FK-проверки, md5-checksum по PK-порядку, chunked checksum для тяжёлых `boq_items*`).
- **Notes:** policy «extra rows» — как в OLD→PROD (seed/reference таблицы допускают preexisting rows, бизнес-таблицы — строгое равенство).

## Stage 7 — Verify password hashes

- **Goal:** доказать, что пароли перенесены byte-to-byte.
- **Input:** PROD `auth.users.encrypted_password` vs Yandex password storage.
- **Output / gate:** **Yandex AUTH_VERIFY_OK**.
- **Prototype:** [`scripts/old-to-prod/08_verify_auth.mjs`](../../scripts/old-to-prod/08_verify_auth.mjs) (сравнение через sha256-fingerprint, сам хеш не логируется; smoke-login).
- **Notes:** Supabase sessions/refresh tokens не мигрируются — пользователи логинятся заново.

## Stage 8 — Verify Go BFF against Yandex

- **Goal:** подтвердить, что Go BFF корректно работает с Yandex как с БД.
- **Input:** Go BFF, указанный на Yandex (в изолированной/тестовой конфигурации, не runtime).
- **Output / gate:** **Go BFF Yandex verification OK**.
- **Prototype:** [`scripts/old-to-prod/09_smoke_go_bff.mjs`](../../scripts/old-to-prod/09_smoke_go_bff.mjs) (health/db, reference-эндпоинты, `/api/v1/me`).
- **Notes:** включая проверку `LISTEN/NOTIFY` (канал `rowchange`) на direct/session-соединении.

## Stage 9 — Switch backend DATABASE_URL to Yandex

- **Goal:** перевести runtime Go BFF на Yandex.
- **Input:** все gate-статусы Stage 6–8 зелёные.
- **Output / gate:** runtime `DATABASE_URL` → Yandex; rollback-план готов.
- **Prototype:** —
- **Notes:** **отдельный защищённый cutover-промт**, не в этом промте и не до выполнения условий из [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md). Frontend никогда не подключается к БД напрямую — единственный runtime-клиент БД это Go BFF.

## Stage 10 — Remove Supabase runtime from frontend/backend

- **Goal:** убрать Supabase SDK/runtime-зависимости после успешного cutover.
- **Input:** успешный Stage 9, стабильная работа на Yandex.
- **Output / gate:** Supabase SDK/env удалены из frontend и backend runtime-пути.
- **Prototype:** —
- **Notes:** выполняется **только после** успешного Yandex-cutover; до этого Supabase остаётся как rollback-путь.

---

### Сводка прототипов из `scripts/old-to-prod/`

| Stage | Прототип |
|---|---|
| 3 Export | `04_export_old.mjs` |
| 4 Import | `06_import_prod.mjs` |
| 5 Passwords | `_auth.mjs` |
| 6 Verify data | `07_verify.mjs` |
| 7 Verify auth | `08_verify_auth.mjs` |
| 8 Verify Go BFF | `09_smoke_go_bff.mjs` |

Будущий pipeline собирается в `scripts/prod-to-yandex/` отдельной задачей после активации.
