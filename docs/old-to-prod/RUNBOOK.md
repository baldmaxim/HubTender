# RUNBOOK: OLD Supabase → PROD Supabase migration

> Operational playbook for Stage 1 of the two-stage migration:
> 1. **OLD Supabase → PROD Supabase** (this runbook).
> 2. PROD Supabase → Yandex Managed PostgreSQL (separate runbook, not in scope here).

## 1. Цель

Перенести пользовательские данные с OLD Supabase-проекта (`wkywhjljrhewfpedbjzx`, live users) в PROD Supabase-проект (`ocauafggjrqvopxjihas`, новая Go BFF-архитектура) **без потери, без коллизий, без сломанных FK**, сохранив возможность залогиниться существующим паролем.

## 2. Почему Yandex пока не трогаем

PROD Supabase — это промежуточный пункт. На нём уже есть baseline-схема (`supabase/migrations/00000000000001-14`), новые pgnotify-триггеры и инфраструктура под будущий Go-Auth (`public.auth_users`, `public.password_reset_tokens`, `public.refresh_tokens`). После успешного OLD → PROD мы получим **single source of truth** для PROD-данных, который затем дампим в Yandex отдельным шагом.

Замена Supabase Auth → Go Auth — **отдельная фаза, после Yandex-миграции**. Сейчас PROD продолжает использовать Supabase Auth, и юзеры будут логиниться через `supabase.auth.signInWithPassword`.

## 3. Заполнить `.env.old-to-prod`

```bash
cp scripts/old-to-prod/.env.old-to-prod.example scripts/old-to-prod/.env.old-to-prod
# Открыть редактором и заполнить (см. .env.old-to-prod.example для пояснений каждого поля)
```

Обязательные:
- `OLD_SUPABASE_DB_URL`, `PROD_SUPABASE_DB_URL` — Session Pooler URL'ы (порт 5432).
- `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` — для smoke-login и Go BFF-проверок.

Желательные:
- `MIGRATION_SMOKE_EMAIL` + `MIGRATION_SMOKE_PASSWORD` — реальная учётка из OLD для проверки после import.
- `GO_BFF_BASE_URL` — для `09_smoke_go_bff`.
- `MIGRATION_TEST_TENDER_ID` / `MIGRATION_TEST_POSITION_ID` — для расширенного smoke.

Safety-флаги (все по умолчанию `false`):
- `ALLOW_CLEAN_PROD` — даёт `--clean-prod` право вызвать TRUNCATE.
- `ALLOW_AUTH_IMPORT` — даёт импортировать `auth.users` / `auth.identities`.
- `ALLOW_DISABLE_IMPORT_TRIGGERS` — даёт `ALTER TABLE … DISABLE TRIGGER` на время import.
- `ALLOW_PROD_OVERWRITE` — даёт `ON CONFLICT DO UPDATE` вместо `DO NOTHING`.
- `ALLOW_WRITE_SMOKE_TESTS` — даёт `09_smoke_go_bff --allow-write-tests`.
- `FORCE_CONFIRM_EMAILS` — выставит `email_confirmed_at = now()` для импортированных юзеров.

## 4. Установить зависимости

```bash
npm install
```

Скрипты используют только `pg` (уже в `devDependencies`) и встроенные Node-модули (`node:util.parseArgs`, `node:crypto`, native `fetch`).

## 5. Проверка связности

```bash
npm run old-to-prod:check
```

Должно вывести `[OLD ] PostgreSQL 17.x — public.users=ok auth.users=ok` и то же для `[PROD]`. exit 0.

## 6. Introspect OLD и PROD

```bash
npm run old-to-prod:introspect-old
npm run old-to-prod:introspect-prod
```

Создаёт `.old-to-prod-export/old_schema.json`, `prod_schema.json`, `*_rowcounts.json`, `*_auth_stats.json`.

## 7. Получить schema_diff

```bash
npm run old-to-prod:compare
```

Создаёт `.old-to-prod-export/schema_diff.json` (machine-readable: `blockers[]`, `risks[]`, `info[]`) и `schema_diff.md` (human-readable, секции 🚨 / ⚠️ / ℹ️).

## 8. Разобрать blockers

Открой `schema_diff.md`. Любой пункт в **🚨 Blockers** — должен быть устранён до запуска import:
- `tables_only_in_old` → добавить таблицу в PROD-миграцию.
- `columns_only_in_old:<table>` → добавить колонку в PROD или явно решить не переносить.
- `enum_values_only_in_old:<enum>` → `ALTER TYPE <enum> ADD VALUE '<x>'` на PROD (вне транзакции).
- `pk_mismatch:<table>` → разрешить ручным DDL.

Раздел **ℹ️ Info** содержит ожидаемую drift (PROD-only таблицы для Go-Auth, миграции 10/12/13/14). Это не блокеры.

## 9. Dry-run export

```bash
npm run old-to-prod:export -- --dry-run
```

Только probe + counts, файлы не пишутся. Проверь, что OLD доступен и количество строк выглядит ожидаемо.

## 10. Export OLD

```bash
npm run old-to-prod:export
```

Дамп всех 40 public-таблиц + `auth.users` + `auth.identities` в `.old-to-prod-export/data/*.ndjson`. Плюс `manifest.json`, `auth_stats.json`.

> `auth.sessions` и `auth.refresh_tokens` не экспортируются (они привязаны к instance_id OLD-проекта).

## 11. Prepare PROD

```bash
npm run old-to-prod:prepare
```

Проверки на PROD (read-only):
- Все таблицы из IMPORT_ORDER присутствуют.
- Все обязательные функции присутствуют (`register_user`, `clone_tender_as_new_version`, `notify_row_change`, и т.д.).
- OAuth-провайдеры из OLD ⊆ `PROD_ENABLED_AUTH_PROVIDERS`.
- PROD `public.users.count == 0` ИЛИ `ALLOW_PROD_OVERWRITE=true` / `ALLOW_CLEAN_PROD=true`.
- Опасные триггеры на PROD найдены; импорт-стратегия определена.

Артефакт: `prepare_status.json` + `docs/old-to-prod/PREPARE_REPORT.md`. Если status ≠ READY → разобрать failed_codes и повторить.

## 12. Import PROD

### 12.-1 Auth conflict policy (fail-by-default, never overwrite)

`auth.users` и `auth.identities` **никогда не используют silent `DO NOTHING`**. Default policy = `AUTH_FAIL_BY_DEFAULT` — INSERT без ON CONFLICT, PG raise'нет на duplicate id / email / (provider, provider_id) и import упадёт с masked-диагностикой.

| Policy | Когда | Что делает |
|---|---|---|
| `AUTH_FAIL_BY_DEFAULT` | default | `INSERT` в `auth.users` / `auth.identities` без `ON CONFLICT`. Duplicate id / email / (provider, provider_id) → fail с masked email, user_id (без `encrypted_password`, без токенов). |
| `AUTH_RESUME_IF_IDENTICAL_ONLY` | `--resume` | SELECT existing PROD row → сравнить все поля **кроме** `encrypted_password` через sha256-fingerprint + дополнительно `sha256(encrypted_password)`. Skip silently **только** если оба совпали. Любое отличие → fail (без логирования значения). |
| `AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY` | post-import | Создаёт email-identity для пользователей без таковой, **только если** `email` провайдер есть в `PROD_ENABLED_AUTH_PROVIDERS`. Записывает список созданных user_id в `import_state.bootstrapped_identities` для AUTH_VERIFY_RESULT.md. |

**Что НЕ работает для auth:**
- `--allow-overwrite` / `ALLOW_PROD_OVERWRITE=true` — **не применяется** к auth-схеме. `encrypted_password` никогда не overwrite-ится — bcrypt-хэш — это эффективно identity юзера, и его потеря = потеря доступа.
- `ON CONFLICT DO UPDATE` для `auth.users` или `auth.identities` — никогда не генерируется.

**Preflight collision check** (`05_prepare_prod`) обходит OLD export и сравнивает с PROD до запуска import-а:
- `auth_users_id_email_mismatch` — тот же `id`, но другой email.
- `auth_users_email_collision_different_id` — тот же email, но другой `id`.
- `auth_users_password_hash_differs` — тот же `id`, но `sha256(encrypted_password)` различается.
- `auth_users_already_present_identical` — строка уже идентична PROD; `resume_safe: true`.
- `auth_identities_user_id_mismatch` — тот же identity `id`, но другой `user_id`.
- `auth_identities_pair_collision_different_user` — `(provider, provider_id)` уже есть в PROD под другим `user_id`.

Если есть НЕ-`resume_safe` коллизии — `prepare` exit-ит с failed-кодом, import отказывается стартовать.

### 12.0 Public conflict policy (fail-by-default)

Импорт **не использует `ON CONFLICT DO NOTHING` по умолчанию**. Этот режим скрыл бы конфликты PK и мог замаскировать commit OLD-данных поверх рассогласованного PROD. Вместо этого действует трёхуровневая policy, явная per-table:

| Policy | Для каких таблиц | SQL |
|---|---|---|
| `FAIL_BY_DEFAULT` | все таблицы по умолчанию | `INSERT …` без `ON CONFLICT` — PG raise'нет на duplicate |
| `SKIP_IF_IDENTICAL` | seed-таблицы (`roles`, `units`, `construction_scopes`, `tender_statuses`, `markup_parameters`, `cost_categories`, `detail_cost_categories`) | SELECT существующий row → compare row fingerprint → skip if equal, fail if differ |
| `OVERWRITE_REQUIRES_TWO_KEY_GUARD` | требует **обоих ключей**: `--allow-overwrite` (CLI) ∧ `ALLOW_PROD_OVERWRITE=true` (env) | `ON CONFLICT (pk) DO UPDATE SET …` |
| `RESUME_DO_NOTHING` | только в `--resume`, для таблиц уже отмеченных в `import_state.completed` | `ON CONFLICT (pk) DO NOTHING` |

На duplicate-fail выводится понятный hint: имя таблицы, conflict key (маскированный UUID), что делать: `--allow-overwrite`, `--clean-prod`, manual resolve.

### 12.1 Сценарий «PROD пуст или почти пуст»

```bash
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run old-to-prod:import -- --dry-run
```

Сначала dry-run. Когда устраивает план — без `--dry-run`.

> **Почему `ALLOW_DISABLE_IMPORT_TRIGGERS=true` обязателен даже на пустом PROD:** триггер `trigger_auto_create_tender_registry` на `public.tenders` выполняет **безусловный** `INSERT INTO tender_registry (...)` без `ON CONFLICT`, поэтому каждый импортируемый тендер создаёт **новую** registry-запись с новым `id` — даже если для этого `tender_number` уже есть и даже если PROD был пуст. То же касается `trg_boq_items_audit` на `boq_items`. Триггеры **всегда** отключаются на время импорта соответствующих таблиц и **обязательно** re-enable'ятся в `finally`.

### 12.2 Сценарий «PROD уже содержит часть данных + хотим overwrite»

```bash
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true ALLOW_PROD_OVERWRITE=true \
  npm run old-to-prod:import -- --allow-overwrite
```

При `--allow-overwrite` + `ALLOW_PROD_OVERWRITE=true` policy переключается на `ON CONFLICT (pk) DO UPDATE SET …`. Без флага — fail-fast.

### 12.3 Сценарий «PROD уже частично заполнен и нужно начать с чистого листа»

```bash
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true ALLOW_CLEAN_PROD=true \
  npm run old-to-prod:import -- --clean-prod --confirm
```

`--clean-prod` TRUNCATE-ит только non-seed-таблицы (seed-таблицы `roles/units/cost_categories/...` пропускаются — у них PROD-данные правильные).

### 12.4 Только auth

```bash
ALLOW_AUTH_IMPORT=true npm run old-to-prod:import -- --auth-only
```

### 12.5 Только public

```bash
npm run old-to-prod:import -- --public-only
```

### 12.6 Resume после ошибки

```bash
npm run old-to-prod:import -- --resume
```

Читает `import_state.json` и продолжает с прерванного места. Для уже отмеченных как completed таблиц переключается на `RESUME_DO_NOTHING` semantics — повторный INSERT не падает, просто skip.

> Артефакт: `docs/old-to-prod/IMPORT_REPORT.md` (перезаписывается каждый запуск).

## 13. Verify (counts + FK + checksums + duplicates)

```bash
npm run old-to-prod:verify
```

Проверки:
- **Row counts** — для каждой таблицы из `IMPORT_ORDER`: `PROD.count >= OLD.count`.
- **FK consistency** — 11 SQL-проверок (orphan rows для `tenders.created_by`, `boq_items.client_position_id`, и т.д.).
- **Table checksums** (новое) — 12 ключевых таблиц (`users, roles, tenders, tender_registry, client_positions, boq_items, boq_items_audit, import_sessions, notifications, cost_redistribution_results, tender_iterations, projects`). Сверяется server-side `md5(string_agg(t::text, ',' ORDER BY pk))` между OLD (записан в `manifest.json` при export) и PROD. Mismatch → **VERIFY_FAILED** (либо WARNING для jsonb-таблиц, см. ниже).
- **tender_registry duplicate check** (новое) — после импорта PROD не должен иметь больше registry-дублей, чем OLD. Если больше → trigger выстрелил → **VERIFY_FAILED**, re-run с `ALLOW_DISABLE_IMPORT_TRIGGERS=true`.
- **boq_items_audit delta** (новое) — PROD audit count не должен превышать OLD audit count. Если превышает на `len(boq_items)` → `trg_boq_items_audit` выстрелил → **VERIFY_FAILED**.

> `auth.users` намеренно исключена из checksum-проверки — её хэш через `string_agg(t::text)` включил бы `encrypted_password`. Это проверяется отдельно в `08_verify_auth` через row-by-row sha256 без логирования.

> Если у таблицы есть jsonb-колонки и checksum не совпал, **но** row counts равны — это может быть просто разный порядок ключей в jsonb после re-insert. Статус → `VERIFY_OK_WITH_WARNINGS`, manual review.

Артефакт: `docs/old-to-prod/VERIFY_RESULT.md`. Статус в последней строке: `VERIFY_OK` / `VERIFY_OK_WITH_WARNINGS` / `VERIFY_FAILED`.

## 14. Verify auth

```bash
npm run old-to-prod:verify-auth
```

Проверки:
- `auth.users.count` PROD ≥ OLD.
- `auth.identities.count` PROD ≥ OLD.
- Для каждой импортированной строки `auth.users.encrypted_password` — byte-to-byte сравнение через sha256 (хэш не печатается).
- Если `MIGRATION_SMOKE_*` задан → реальный login через PROD Supabase Auth REST.
- Если `GO_BFF_BASE_URL` задан → `GET /api/v1/me` с полученным токеном.

Артефакт: `docs/old-to-prod/AUTH_VERIFY_RESULT.md`. Статус: `AUTH_VERIFY_OK` / `WITH_WARNINGS` / `AUTH_VERIFY_FAILED`.

## 15. Smoke Go BFF

```bash
npm run old-to-prod:smoke
```

Smoke-login → 11+ read-only endpoint-вызовов через `GO_BFF_BASE_URL`. С `--tender-id` / `--position-id` — добавляются tender-specific эндпоинты.

Артефакт: `docs/old-to-prod/PROD_GO_BFF_VERIFICATION.md`. Статус: `READY_FOR_YANDEX_MIGRATION` / `READY_WITH_WARNINGS` / `NOT_READY`.

Status = READY_FOR_YANDEX_MIGRATION ставится только если все три отчёта (verify, verify-auth, smoke) — clean.

## 16. Cutover / OLD read-only

Между шагами 10 (export) и 14 (verify-auth) — окно cutover. В этом окне любой write в OLD будет потерян.

### Основной способ (рекомендуется): application-level maintenance

1. Перевести фронт OLD в **maintenance mode** (баннер «обновление сервиса»).
2. **Остановить write-path** старого backend / отключить пишущие эндпоинты.
3. Только потом запускать `npm run old-to-prod:export`.

Это самый надёжный метод: write-path действительно остановлен, никаких новых строк в OLD не появится.

### Опционально (advanced): DB-level read-only

Только если application-level maintenance невозможен или нужна дополнительная защита.

> **Важно:** `service_role` — это **Supabase API key**, не PostgreSQL DB user. SQL-команды ниже выполняются через **PostgreSQL connection string** под обычным DB-пользователем (`OLD_SUPABASE_DB_URL` из `.env.old-to-prod`, например через `psql "$OLD_SUPABASE_DB_URL"`).

```sql
-- На OLD, через PostgreSQL connection string (НЕ через Supabase REST/service_role):
ALTER DATABASE postgres SET default_transaction_read_only = on;
```

**Caveats:**
- ⚠ Уже **открытые транзакции и сессии** этот ALTER **не аборtит**. Поэтому приложение всё равно нужно остановить или перевести в maintenance — DB-уровень это complementary защита, не основная.
- ⚠ Все будущие write-транзакции в OLD будут падать с ошибкой `cannot execute … in a read-only transaction` — клиенты увидят явную ошибку (на фронте лучше иметь baner).

**Rollback (обязателен, если решили вернуться на OLD):**
```sql
-- На OLD, через PostgreSQL connection string:
ALTER DATABASE postgres RESET default_transaction_read_only;
```

**Перед prod**: обязательно проведите rehearsal на staging — поймёте, как ведёт себя ваше приложение, когда DB read-only включён.

## 17. Что делать с write-window

Если кто-то всё-таки записал в OLD после export — есть три варианта:
1. **Принять потерю** — крошечный delta, неважно (для тестовой миграции — OK).
2. **Повторить весь цикл** — re-introspect → re-export → re-import (с `--allow-overwrite ∧ ALLOW_PROD_OVERWRITE=true` если PROD уже содержит часть данных) → verify. Default fail-by-default policy сам подскажет, что данные расходятся.
3. **Targeted delta-import** — выгрузить только новые строки за окно и импортировать таргетно (требует CDC или ручного SQL). По умолчанию не реализовано.

## 18. Что делать с duplicate emails

`05_prepare_prod` сообщит, если есть дубли. Разрешать вручную **до** import. Выполняется через **PostgreSQL connection string** (`OLD_SUPABASE_DB_URL`), не через Supabase REST API:

```bash
psql "$OLD_SUPABASE_DB_URL" <<'SQL'
SELECT email, array_agg(id ORDER BY created_at) AS ids
  FROM auth.users WHERE email IN (<duplicates>) GROUP BY email;
-- Для каждого дубля: оставить более новый id, у старого изменить email:
UPDATE auth.users SET email = id || '+legacy@old.local' WHERE id = '<old-id>';
SQL
```

Снова `npm run old-to-prod:export`.

## 19. Что делать с OAuth-only users (без `encrypted_password`)

Если в `auth_stats.json` есть `users_without_encrypted_password > 0`:
- импорт `auth.users` пройдёт (encrypted_password = NULL допустим).
- импорт `auth.identities` принесёт OAuth-identity.
- **необходимо**: в PROD Supabase Dashboard → Auth → Providers — включить тот же OAuth-провайдер (Google/GitHub/…) и настроить redirect URLs на PROD-домен.
- иначе юзер не сможет залогиниться, пока провайдер не настроен.

В нашем сценарии (см. [01_OLD_TO_PROD_AUDIT.md § 3.6](01_OLD_TO_PROD_AUDIT.md#36-auth-статистика)) `oauth_only_users_count = 0`, так что этот пункт не выстреливает.

## 20. Что делать с неподтверждёнными email (`email_confirmed_at IS NULL`)

Вариант A (рекомендуется): `FORCE_CONFIRM_EMAILS=true` при import — выставит `email_confirmed_at = now()` для всех юзеров с email-провайдером. Скрипт залогирует list user_id в `IMPORT_REPORT.md`.

Вариант B: оставить `NULL` → юзеру при первом login GoTrue PROD отправит письмо confirm.

В нашем сценарии `email_confirmed_at_null_count = 0`, поэтому не актуально, но опция есть.

## 21. Почему `auth.sessions` / `refresh_tokens` не переносятся

- Привязаны к OLD-проекта `instance_id` и JWT-secret OLD.
- На PROD `instance_id` другой, JWT-secret другой → токены просто не валидируются.
- Это не баг, это нормальный cutover: все юзеры однократно logout → login с тем же паролем (хэш скопирован) → новая сессия от PROD.

## 22. Почему пользователи перелогинятся

См. § 21. Эффект:
- первый запрос после cutover → 401 на старой сессии (живёт в localStorage).
- `src/lib/api/client.ts` перехватывает 401 → redirect на `/login`.
- юзер вводит email + пароль (тот же, что в OLD).
- bcrypt-сравнение проходит (хэш скопирован byte-to-byte).
- получает новый JWT, подписанный PROD-секретом.
- работает дальше.

UX-окно: 1 redirect + 1 ввод пароля (или 1 клик если браузер сохранил).

## 23. Как откатиться на OLD

Если что-то пошло не так на PROD:
1. В `.env` Go BFF / фронт-`.env` верни `VITE_SUPABASE_URL` / `SUPABASE_JWKS_URL` на OLD-значения.
2. На OLD (через PostgreSQL connection string): `ALTER DATABASE postgres RESET default_transaction_read_only;` (если включал read-only). Это полный rollback команды из § 16.
3. Запушь rollback-deploy фронта и Go BFF.
4. На PROD — оставь импортированные данные как есть; PROD после rollback просто временно неиспользуется.
5. Разбери причину провала (`VERIFY_RESULT.md`, `IMPORT_REPORT.md`), исправь, повтори цикл.

## 24. Когда PROD Supabase готов как source для Yandex migration

Все три из:
- `VERIFY_RESULT.md` → `VERIFY_OK`.
- `AUTH_VERIFY_RESULT.md` → `AUTH_VERIFY_OK`.
- `PROD_GO_BFF_VERIFICATION.md` → `READY_FOR_YANDEX_MIGRATION`.

И:
- юзеры пользуются PROD как минимум 24 часа без новых жалоб на login / read-операции.
- ни одного незакрытого blocker'а в `schema_diff.md` нового прогона `compare`.

После этого можно дампить PROD в Yandex (см. отдельный `docs/yandex-migration/`).

---

## Quick reference — все команды

```bash
# одноразово
cp scripts/old-to-prod/.env.old-to-prod.example scripts/old-to-prod/.env.old-to-prod
# заполнить .env.old-to-prod
npm install

# цикл аудита (read-only)
npm run old-to-prod:check
npm run old-to-prod:introspect-old
npm run old-to-prod:introspect-prod
npm run old-to-prod:compare
# проверить .old-to-prod-export/schema_diff.md — секция 🚨 должна быть пустой

# export (read-only OLD)
npm run old-to-prod:export -- --dry-run
npm run old-to-prod:export

# prepare (read-only PROD)
npm run old-to-prod:prepare

# import (DESTRUCTIVE — требует ALLOW_AUTH_IMPORT=true и т.д.)
# Default policy: FAIL_BY_DEFAULT — упадёт при duplicate PK без silent skip.
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run old-to-prod:import -- --dry-run
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run old-to-prod:import

# import с overwrite (если PROD уже содержит совпадающие PK)
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true ALLOW_PROD_OVERWRITE=true \
  npm run old-to-prod:import -- --allow-overwrite

# import с предварительной очисткой PROD (TRUNCATE non-seed tables)
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true ALLOW_CLEAN_PROD=true \
  npm run old-to-prod:import -- --clean-prod --confirm

# verify (now includes checksums + tender_registry duplicate check + audit delta)
npm run old-to-prod:verify
npm run old-to-prod:verify-auth
npm run old-to-prod:smoke

# или одной командой (orchestrator)
ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run old-to-prod:migrate
```
