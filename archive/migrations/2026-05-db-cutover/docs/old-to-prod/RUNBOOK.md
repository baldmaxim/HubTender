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

## 10.A Snapshot-strategy для export (REPEATABLE READ + keyset pagination)

С коммита `6878434+` `04_export_old.mjs` всегда работает внутри транзакции:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- все SELECT'ы (counts, table dumps, sql_checksum, auth_stats,
-- tender_registry duplicates) выполняются на одном connection
COMMIT;  -- либо ROLLBACK при ошибке
```

### Почему это критично

`LIMIT/OFFSET`-пагинация на **живой** таблице, в которую идут писатели, неизбежно даёт **drift**:
- новая строка вставляется во время export'а;
- она получает UUID, который сортируется *выше* текущего offset → ранее видимая строка сдвигается на одну позицию;
- следующий `SELECT ... LIMIT N OFFSET M` снова возвращает её → в NDJSON попадает дубликат.

Симптом, который мы поймали в первом rehearsal: `public.boq_items_audit.ndjson` содержал 338 100 строк, но только 337 988 уникальных id. 112 дубликатов привели к `Duplicate key` на import. На другие таблицы drift не сработал просто потому, что rate-of-change был низкий.

### Что даёт REPEATABLE READ snapshot

- Все SELECT внутри транзакции видят одну и ту же фиксированную версию данных, сделанную в момент первого statement'а.
- Записи других транзакций, committed-нутые **после** начала export'а, **не видны** этому export'у.
- На сторону OLD никаких блокировок не накладывается — другие пользователи продолжают писать, мы их writes просто игнорируем.
- На стороне нашего export'а это значит: row-count, NDJSON-row-count и server-side md5-checksum считаются над **одинаковым** набором строк.

### Что даёт keyset pagination

Дополнительная защита. Вместо `LIMIT N OFFSET M`:

```sql
SELECT * FROM "schema"."table"
 WHERE "pk" > $last_pk
 ORDER BY "pk"
 LIMIT $batch_size;
```

Это:
- O(B·log N) cost per batch (vs OFFSET's O((N/B)·N)) — на больших таблицах в разы быстрее;
- работает корректно даже без snapshot;
- инвариант: каждая запись попадает в выдачу **ровно один раз**.

### Post-export validation

После каждого NDJSON-файла запускается `validateNdjsonPks(path, pkColumn)`:
- считает total lines, distinct PK count, duplicate PK count;
- сэмплит первые 5 дублирующихся PK (с маскированием — `pk.slice(0,12)+'…'`);
- результат пишется в `manifest.tables[].duplicate_pk_count` + отдельный файл `export_validation.json`.

**Если `validation.duplicate_pk_total > 0`** → export завершается **`exit 8`** + текстом «Export validation FAILED». `npm run old-to-prod:import` после этого работать не будет (manifest содержит `duplicate_pk_count > 0`, но мы решили не блокировать import формально — failure surfaces через 06's per-table dedup throw).

### Что snapshot НЕ решает

- **Записи, появившиеся после snapshot start, не попадут в PROD**. Это значит, для финального cutover OLD всё равно лучше переводить в maintenance/freeze (раздел 16) — иначе у вас в PROD будет «фотография» OLD на момент начала export'а, а не на момент cutover.
- **Snapshot держится только в пределах одного процесса/connection**. Если export разнесён по нескольким Node-процессам (например, отдельный auth-export), они увидят разные snapshot'ы. Сейчас всё в одном процессе → OK.
- **Long-running snapshot** может конфликтовать с aggressive VACUUM на OLD — но для нашего размера (минуты, не часы) проблемы нет.

### Что делать если validation failed

```
✗ Export validation FAILED: 112 duplicate PK(s) across 1 table(s).
    - public.boq_items_audit: 112 duplicate PK(s) detected in NDJSON — export inconsistent.
```

1. Снэпшот должен был защитить — если не сработал, проверить:
   - все ли SELECT'ы идут на одном `client` (single connection);
   - не используется ли pgBouncer transaction-mode (тогда снэпшот рвётся между запросами; на Supabase Session Pooler этого не происходит);
   - не пишет ли что-то параллельно из самого скрипта (не должно).
2. Re-export после фикса.
3. **Не запускать import** пока `export_validation.json.duplicate_pk_total = 0`.

### Emergency rehearsal mode

`ALLOW_IMPORT_DEDUP_FOR_REHEARSAL=true` + CLI `--allow-import-dedup-for-rehearsal` позволяют 06_import_prod продолжить import при duplicate PK в NDJSON, дедуплицируя по PK во время чтения. Это «emergency escape» только для rehearsal — VERIFY-статус автоматически downgrade'ится до `VERIFY_OK_WITH_WARNINGS`. **Для production cutover** этот режим НЕ использовать — нужно перевыгрузить OLD корректно.

## 10.B Pool-safe export mode for Supabase OLD

### Когда использовать `--pool-safe-export`

Когда OLD-connection-strings указывает на **Supabase Session Pooler** (`aws-0-<region>.pooler.supabase.com:5432`), и пул разделён с live frontend-traffic'ом. В этой конфигурации **глобальный REPEATABLE READ snapshot** (раздел 10.A) держит pool-slot на ~25-30 минут, и любой connection-error превращается в длинную зомби-сессию, которая блокирует pool до `idle_in_transaction_session_timeout` server-side. Если три или четыре export-ов подряд упадут — pool полностью saturated, MCP перестаёт отвечать.

Pool-safe режим **не открывает длинную транзакцию**. Каждая таблица получает свой fresh-client + COUNT + keyset stream + checksum (если позволено) + close, без `BEGIN`/`COMMIT` снаружи.

Команда:

```powershell
npm run old-to-prod:export -- --use-mcp-preflight --pool-safe-export --batch-size=2500
```

### Почему не используем глобальный snapshot через Session Pool

Supabase Session Pooler (Supavisor) держит лизинг на back-end-connection пока pg-node не вызовет `client.end()`. Если внутри лизинга открыта REPEATABLE READ-транзакция, любые ошибки протокола (timeout, network blip) оставляют back-end-сессию в `idle in transaction (aborted)`, и pool-slot не освобождается до server-side `idle_in_transaction_session_timeout` (30 минут на free-tier, может больше). Несколько таких aborted-snapshot-сессий быстро исчерпывают доступные слоты.

В **direct-connection** режиме (`db.<ref>.supabase.co`) каждое подключение — отдельный back-end-процесс, не shared с пулером. Длинный snapshot там безопаснее. Для direct можно установить `OLD_SUPABASE_EXPORT_DB_URL` (см. ниже) и оставить дефолтный snapshot-режим.

### Как обеспечивается consistency без snapshot'а

`--pool-safe-export` пишет в `manifest.json`:

```json
"consistency_mode": "operator_no_writes_pool_safe",
"pool_safe_export": true,
"transaction_snapshot": false,
"operator_confirmed_no_writes_required": true
```

И в `export_validation.json` — warning:

> Pool-safe export skips REPEATABLE READ snapshot. Cross-table consistency relies on operator-confirmed write-freeze of OLD. Production cutover MUST NOT use this mode without explicit freeze.

Cross-table consistency обеспечивается оператором — пока pool-safe export идёт, никто не должен писать в OLD. Без freeze'а возможны:
- новые тендеры/строки появляются после COUNT, но до stream → manifest row_count < NDJSON line count;
- audit-rows вставляются в `boq_items_audit` параллельно с export'ом → duplicate-PK detection поймает (или нет, если rate низкий).

**Для production cutover** `--pool-safe-export` использовать **запрещено** без явного OLD write-freeze (frontend maintenance banner + 503 на write-path). Только для rehearsal на operator-confirmed quiet OLD.

### Почему нельзя запускать много export-attempt подряд

Каждый aborted run = ещё одна зомби-сессия в Supavisor (плюс ещё одна в back-end). С каждым ретраем pool сжимается. Когда осталось <5 свободных слотов:
- live front-end теряет latency;
- MCP отдаёт `Connection terminated due to connection timeout`;
- npm-скрипты получают `ECHECKOUTTIMEOUT in Session mode`.

Восстановление = **подождать 20-30 минут** server-side `idle_in_transaction_session_timeout`. Перезапуск Supabase проекта тоже сбросит зомби, но дисраптит live users.

### Что делать при `ECHECKOUTTIMEOUT`

1. **НЕ перезапускать export** немедленно — каждый attempt усугубляет saturation.
2. Подождать ~30 мин. Перепроверить через `npm run old-to-prod:check`:
   - если PROD проходит а OLD — `XX000` / connection timeout, pool ещё не вылечился.
   - повторять с интервалом 5-10 мин, **не чаще**.
3. Когда `npm run old-to-prod:check` отвечает быстро (<10 сек), **только тогда** запускать export.
4. Сразу с `--pool-safe-export` — не возвращайтесь к long snapshot mode, пока root-cause не пофикшен (например, switching to direct connection).

### Direct connection как предпочтительный путь

Если у OLD доступна direct connection (`db.<ref>.supabase.co:5432`), используйте её для export'а:

```bash
# Supabase Dashboard → Settings → Database → Connection string → URI (direct)
# Скопировать в .env.old-to-prod как OLD_SUPABASE_EXPORT_DB_URL
OLD_SUPABASE_EXPORT_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
```

`04_export_old.mjs` подхватит этот URL только для export, не трогая `OLD_SUPABASE_DB_URL` (который остаётся пуловым для check/connection-сanity). Логи покажут `host type: direct`.

С direct connection можно вернуться к default (snapshot) режиму — без `--pool-safe-export` — потому что back-end-connection не делится с frontend-traffic'ом.

> ⚠ Supabase free-tier не предоставляет IPv4-direct (только IPv6). На Windows без IPv6-поддержки direct не сработает — fallback на pool-safe через Session Pooler.

### Real import всё равно запрещён без backup/restore point

Pool-safe export — только этап подготовки данных. Перед `--clean-prod --clean-auth` import'ом всё равно обязательны:
- Supabase Dashboard restore point на PROD (или `pg_dump` через docker — см. раздел 12.A "Backup PROD");
- актуальные `prepare_status.json` (status: READY) и `auth_collision_analysis.json` (recommendation ∈ {clean-prod, clean-auth}).

## 10.C Temporal raw parsers (date / timestamp / timestamptz fidelity)

### Симптом (был)

Strict cutover с **замороженным** OLD всё равно давал `VERIFY_FAILED` на
`public.client_positions` и `public.projects`. Row counts совпадали,
`duplicate_pk_total=0`, auth — `AUTH_VERIFY_OK`.

### Причина

node-postgres по умолчанию парсит `date`/`timestamp`/`timestamptz` в JS
`Date`. JS `Date` имеет только миллисекундную точность и привязан к
таймзоне Node-процесса. На экспорте это:

- усекало микросекунды у `timestamptz` (`.309186`→`.309`);
- сдвигало **каждое** `date`-значение на **−1 день** (например
  `projects.contract_date`, `construction_end_date`).

Это была реальная порча данных пайплайном, а не live-writes (см.
`docs/old-to-prod/VERIFY_ROOT_CAUSE.md`; гипотеза §7
`REHEARSAL_VERIFICATION_DECISION.md` — superseded).

### Что сделано

- `_lib.mjs::installPgRawTemporalParsers()` — process-wide raw-text
  парсеры для `DATE`/`TIMESTAMP`/`TIMESTAMPTZ` (builtins + OID
  1082/1114/1184 fallback), вызывается в `getClient()` до создания клиента.
- `getClient()` после connect: `SET TIME ZONE 'UTC'` +
  `SET DateStyle = 'ISO, MDY'`. Ошибка SET ⇒ соединение закрывается +
  throw (fail-fast). Делает server-side `md5(string_agg(t::text))`
  детерминированным на OLD и PROD.
- `assertTemporalRawParsers()` — self-check, экспорт (`04`, оба режима) и
  verify (`07`) падают, если pg всё ещё отдаёт JS Date. Результат пишется
  в `export_validation.json.temporal_parser_check` и `manifest.json`
  (`temporal_raw_parsers`/`session_time_zone`/`date_style`).
- `_copy.mjs::normalizeForPg()` бросает, если получил JS `Date`
  (regression guard).

### Regression test (read-only, ничего не меняет)

```bash
npm run old-to-prod:test-temporal          # default target = PROD (disposable)
# TEMPORAL_TEST_DB=old npm run old-to-prod:test-temporal
```

TEMP TABLE + ROLLBACK. Ожидаемо: `TEMPORAL_ROUNDTRIP_OK` (date без сдвига,
timestamp/timestamptz сохраняют `.123456`, tstz в UTC).

## 10.D Strict verify — known pitfalls (path to VERIFY_OK без ручных исключений)

Историю и доказательства см. `docs/old-to-prod/VERIFY_ROOT_CAUSE.md`.
Четыре класса расхождений, которые мешали строгому `VERIFY_OK`, и как они
закрыты в пайплайне (никаких ручных whitelist'ов):

1. **date/timestamp/timestamptz → JS Date.** Raw parsers (OID
   1082/1114/1184) + сессия `UTC` / `ISO, MDY` (§10.C). −1 день у date,
   усечение µs у timestamptz устранены.
2. **json/jsonb → JS object.** node-postgres по умолчанию парсит JSON/JSONB
   (OID 114/3802) в объект; `JSON.stringify` не воспроизводит каноничный
   текст PG (scale `2.50`→`2.5`, порядок ключей). Фикс: raw парсеры и для
   JSON/JSONB (`installPgRawTypeParsers`), `normalizeForPg` пропускает
   каноничную строку как есть. Проверка:
   `npm run old-to-prod:test-raw-types` (date/timestamp/timestamptz/json/
   jsonb, TEMP TABLE + ROLLBACK, jsonb обязан вернуться строкой, не object).
3. **tenders.updated_at = время миграции.** На `public.tenders` есть
   BEFORE UPDATE триггер `update_tenders_updated_at` (`handle_updated_at()`
   → `now()`). Импорт дочерних строк каскадит `UPDATE public.tenders`
   (recompute cached_grand_total) → триггер перезаписывал updated_at.
   Фикс: `06_import_prod` динамически находит этот триггер, **DISABLE на
   всё окно public-импорта** (gated `ALLOW_DISABLE_IMPORT_TRIGGERS=true`),
   targeted restore только `updated_at` из OLD NDJSON, ENABLE в finally.
   Счётчик `restored_tenders_updated_at` в `IMPORT_REPORT.md`. Бизнес- и
   system-триггеры не трогаются; `session_replication_role` не используется.
4. **heavy / пустые таблицы.** `boq_items` чексумма пропускалась
   (HEAVY_CHECKSUM_SKIP / pool-safe >100k) → вечный WARN; `notifications`/
   `tender_iterations` (0/0) тоже WARN. Фикс: `chunkedTableChecksum()` —
   keyset-чанковый `md5(string_agg(t::text ORDER BY pk))` со
   детерминированной сборкой (та же семантика PG `t::text`, ограничено по
   времени на чанк). Export пишет `sql_checksum_mode`/
   `sql_checksum_chunk_size` в manifest, verify пересчитывает тем же
   разбиением. Пустая 0/0 = **match**; невычислимая чексумма = **FAIL**
   (не warning); `jsonb_warning`-даунгрейд убран (jsonb теперь
   байт-детерминирован). `boq_items_audit` остаётся вне `CHECKSUM_TABLES`
   (целостность доказана row-count + file sha256 + dup-PK scan +
   inflation=0).

`VERIFY_OK` теперь достижим, если: row counts OK, FK OK, registry dups OK,
audit inflation OK, **все** чексуммы match (вкл. chunked heavy и пустые
0/0). `VERIFY_OK_WITH_WARNINGS` остаётся только для нестрогих rehearsal-
прогонов (например `preexisting_rows` на seed/template без
`--clean-prod-include-seeds`).

### Повторный strict cutover после фикса

OLD должен быть заморожен. Real import — только по отдельному
подтверждению оператора. **Предыдущие NDJSON не использовать** (нужен
свежий export с raw json/jsonb парсерами):

```powershell
npm run old-to-prod:check
npm run old-to-prod:test-raw-types      # ожидаем RAW_TYPE_ROUNDTRIP_OK
npm run old-to-prod:export -- --use-mcp-preflight --pool-safe-export --batch-size=2500
#   → .old-to-prod-export/export_validation.json:
#     duplicate_pk_total=0, errors=[], temporal_parser_check.{date,timestamp,timestamptz} OK
#   → manifest.json: heavy CHECKSUM_TABLES имеют sql_checksum_mode="chunked"
$env:ALLOW_AUTH_IMPORT="true"; $env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
$env:ALLOW_CLEAN_AUTH="true"; $env:ALLOW_CLEAN_PROD="true"
npm run old-to-prod:prepare -- --use-mcp-preflight --clean-auth --clean-prod --confirm
npm run old-to-prod:migrate -- --use-mcp-preflight --import-only --clean-auth --clean-prod --clean-prod-include-seeds --confirm --batch-size=5000
npm run old-to-prod:verify        # ожидаем VERIFY_OK (строгий)
npm run old-to-prod:verify-auth   # ожидаем AUTH_VERIFY_OK
```

`--clean-prod-include-seeds` обязателен: PROD seed-таблицы содержат
µs-усечённый residue прошлых pre-fix прогонов; флаг переимпортирует 7 seed
байт-точно из OLD (тот же 3-key gate, что и `--clean-prod`; НЕ
`--allow-overwrite`/`ALLOW_PROD_OVERWRITE`). Yandex — только после
`PROD_GO_BFF_VERIFICATION.md = READY_FOR_YANDEX_MIGRATION`.

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

## 12.A Clean-auth strategy для OLD-as-truth-of-record

### Когда нужен `--clean-auth`

Когда PROD `auth.users` / `auth.identities` уже содержат частично импортированные строки **с теми же id, что и на OLD**, но из-за активности пользователей на OLD данные разошлись:

- кто-то сменил пароль → `encrypted_password` различается (`PASSWORD_HASH_DRIFT`).
- кто-то обновил профиль → `raw_user_meta_data` / `raw_app_meta_data` различается (`USER_META_DRIFT`).
- появились новые OLD-пользователи, которых нет на PROD.

В этом сценарии `--resume` (`AUTH_RESUME_IF_IDENTICAL_ONLY`) **не пройдёт** — он требует byte-identical PROD-строку. `ALLOW_PROD_OVERWRITE` к auth-таблицам **не применяется** (по дизайну — overwrite пароля молча недопустим). Остаётся вариант: «снести auth на PROD и заново импортировать из OLD» — это и есть `--clean-auth`.

Решение запускать clean-auth должно быть подтверждено через MCP-анализ коллизий: `node` скрипт пишет `.old-to-prod-export/auth_collision_analysis.json` с `recommendation ∈ {clean-prod, clean-auth}`. Без этого файла `assertCleanAuthAllowed` откажется проходить.

### Почему ручной `DELETE FROM auth.users` опасен

- В Supabase `public.users.id → auth.users.id` обычно сидит FK c `ON DELETE CASCADE` — ручной DELETE незаметно сотрёт связанные `public.users`. Скрипт строит FK-граф через `pg_constraint` и **отказывается** работать в этой конфигурации без явного `--clean-prod --confirm` в том же запуске.
- Auth-таблицы (`auth.refresh_tokens`, `auth.sessions`, `auth.identities`, `auth.mfa_*`, …) имеют свою FK-цепочку. Голый `DELETE FROM auth.users` либо упадёт на RESTRICT, либо триггерит каскад. `cleanAuthTarget()` выполняет DELETE в топологически отсортированном порядке (листья → корень), без `CASCADE`.
- Никто не записывает в `IMPORT_REPORT.md`, что и сколько было удалено вручную. После cleanAuthTarget — точные before/after counts, причины пропуска, FK-связи с public — всё в отчёте.

### Почему adopt-existing не подходит при password hash drift

`AUTH_RESUME_IF_IDENTICAL_ONLY` сравнивает byte-identical signature (включая `sha256(encrypted_password)`). Любой различающийся пользователь → fail с masked diagnostic. Так задумано: нельзя «принять» PROD-строку, не зная, какой из двух паролей актуален. OLD — truth-of-record (живой prod), значит PROD-пароль может быть устаревшим.

### Почему `auth.sessions` / `refresh_tokens` не мигрируются

- Это технологические токены конкретного Supabase-instance. JWT signing key и issuer URL отличаются между OLD и PROD проектами — токены OLD на PROD ничего не значат.
- При `--clean-auth` они стираются вместе с остальным auth-target'ом.
- Импорт `04_export_old.mjs` их **не выгружает** — только `auth.users` + `auth.identities`.

### Что произойдёт с пользователями после cutover

- Все OLD-сессии **немедленно недействительны** (auth.sessions/refresh_tokens сброшены).
- При следующем входе пользователь логинится **тем же паролем** (хэш скопирован из OLD).
- Frontend получает 401 на старой сессии в `localStorage` → форсирует логин-флоу.

### Команды

#### dry-run (никаких записей в PROD)

```powershell
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
$env:ALLOW_CLEAN_AUTH="true"
$env:ALLOW_CLEAN_PROD="true"
npm run old-to-prod:migrate -- --dry-run --use-mcp-preflight --clean-auth --clean-prod --confirm
```

Выведет план: какие auth-таблицы попадают в scope, в каком порядке будут DELETE'нуты, какие public→auth FK обнаружены, before counts. Никаких записей не выполняется. Артефакты: `PREPARE_REPORT.md` с секцией «Clean-auth plan», `IMPORT_REPORT.md` с разделом «Clean-auth phase» (с `executed: NO (dry-run only)`).

#### Реальный rehearsal (PROD пишется)

```powershell
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
$env:ALLOW_CLEAN_AUTH="true"
$env:ALLOW_CLEAN_PROD="true"
npm run old-to-prod:migrate -- --use-mcp-preflight --clean-auth --clean-prod --confirm
```

После выполнения проверьте:

- `docs/old-to-prod/IMPORT_REPORT.md` → раздел «Clean-auth phase»: `executed: YES`, before/after counts, public→auth FK list.
- `docs/old-to-prod/VERIFY_RESULT.md` → `VERIFY_OK`.
- `docs/old-to-prod/AUTH_VERIFY_RESULT.md` → `AUTH_VERIFY_OK` + раздел «Clean-auth context» с подтверждением.

#### Только auth (без trogания public, ТОЛЬКО если нет public→auth FK)

```powershell
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
$env:ALLOW_CLEAN_AUTH="true"
npm run old-to-prod:migrate -- --use-mcp-preflight --clean-auth --auth-only
```

Если в реальности есть `public.users → auth.users` (типичный Supabase setup) — скрипт **откажется** запускаться. Сообщение:

```
✗ Cannot clean auth.users while public.users still references auth.users. Use --clean-prod --confirm or resolve manually.
```

Это правильное поведение: голый clean-auth + auth-import оставит public.users-данные ссылающимися на не-существующих auth.users → FK violation при следующем INSERT/UPDATE.

### Generated columns в auth.identities

С версии Supabase Auth ≥2023.5 колонка `auth.identities.email` помечена как `GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED`. В этот столбец **запрещено** вставлять значения — PostgreSQL отдаёт ошибку `cannot insert a non-DEFAULT value into column "email"`.

`importAuthIdentities()` ([06_import_prod.mjs](../../scripts/old-to-prod/06_import_prod.mjs)) во время выполнения вызывает `listInsertableColumns('auth','identities')` из [_auth.mjs](../../scripts/old-to-prod/_auth.mjs):
- получает список колонок через `information_schema.columns`,
- исключает `is_generated='ALWAYS'` и `is_identity='ALWAYS'`,
- INSERT использует пересечение «exported NDJSON columns ∩ insertable PROD columns»,
- skipped колонки логируются + попадают в `IMPORT_REPORT.md` раздел «Generated/identity columns skipped during auth.identities INSERT».

После import:
- `08_verify_auth.mjs` дополнительно проверяет, что `auth.identities.email = lower(identity_data->>'email')` для всех строк (drift > 0 → FAIL).
- Отдельный раздел в `AUTH_VERIFY_RESULT.md` подтверждает «email_is_generated: true, drift_count: 0 ✓».

Тот же подход применяется в `bootstrapMissingIdentities()` — defense in depth.

### Re-run after a failed import

Если предыдущий запуск упал, `import_state.json` остался от него. При повторном запуске **без `--resume`**:
- `06_import_prod.mjs` автоматически переименует существующий файл в `import_state.failed.<ISO>.json` (auditable history) и стартует с чистого состояния,
- логирует в stdout: `archived previous import_state → …`.

`--resume` использовать только если вы **уверены**, что failed run прошёл далеко (например, упал на одной таблице в середине public phase) и хотите продолжить. После root-cause-фикса схемы или политики `--resume` обычно НЕ применим — нужен полный clean-prod + clean-auth.

### Безопасность

- `assertCleanAuthAllowed` — three-key guard: CLI флаг + `ALLOW_CLEAN_AUTH=true` + `ALLOW_AUTH_IMPORT=true`.
- Дополнительные preflight'ы: `schema_diff.blockers` пустой, `MCP_PREFLIGHT` не FAILED, `auth_collision_analysis.json` присутствует и `recommendation ∈ {clean-prod, clean-auth}`, PROD-only users == 0, identity_provider_collisions == 0.
- FK-граф строится во время выполнения через `pg_constraint` — никакого хардкода под конкретные версии GoTrue.
- DELETE выполняется без `CASCADE`. `session_replication_role` не трогается. Системные/internal-триггеры не отключаются.
- Post-clean assert: `COUNT(*) = 0` для каждой таблицы из плана. При первом нарушении — throw.

### Rollback

После запуска `--clean-auth` сделать rollback **нельзя** — DELETE необратим. Если что-то пошло не так:

1. OLD остаётся нетронутым (read-only).
2. На PROD: повторный `npm run old-to-prod:import -- --use-mcp-preflight --auth-only` ре-импортирует `auth.users` + `auth.identities` из локального NDJSON. Bootstrap идентичностей повторно покроет OLD users без identities.
3. Если NDJSON-export'а нет — пересоздать через `npm run old-to-prod:export -- --use-mcp-preflight` (OLD read-only).

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

`verify-auth` теперь также выполняет **NULL token-column audit** (см. §14.A): любая существующая колонка из `AUTH_USERS_NOT_NULL_TOKENS` с NULL → `AUTH_VERIFY_FAILED`.

## 14.A Repair GoTrue NULL token fields

### Симптом

`verify-auth` показывает все DB-метрики зелёными (counts/passwords/identities/bootstrap match), но `smoke login` падает:

```
✗ smokeLogin failed: HTTP 500 {"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}
```

### Причина

Supabase GoTrue сканирует строки `auth.users` в Go-структуру, где token/change-колонки объявлены как **non-pointer `string`**, не `*string`. Если любая из них = **NULL** (даже если колонка `is_nullable = YES` на уровне БД), `database/sql` падает с `converting NULL to string is unsupported` → GoTrue отдаёт HTTP 500 «Database error querying schema» на **любой** login.

Затронутые колонки (`AUTH_USERS_NOT_NULL_TOKENS` в `scripts/old-to-prod/_mapping.mjs`):
`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `email_change`, `reauthentication_token`, `phone_change`, `phone_change_token`.

`06_import_prod` coerce'ит NULL→'' для этих колонок на import'е. Но если список был неполон (исторический баг — `email_change`/`phone_change`/`phone_change_token` отсутствовали), уже импортированные строки остаются с NULL. `10_repair_prod_auth_tokens.mjs` чинит это **без повторного полного public-import**.

### Dry-run (по умолчанию ничего не меняет)

```powershell
npm run old-to-prod:repair-auth -- --dry-run
```

Покажет per-column `null_before / updated(0) / null_after` и `status: DRY_RUN_PENDING_APPLY` если есть что чинить. Артефакт: `docs/old-to-prod/AUTH_REPAIR_RESULT.md`.

### Apply (two-key guard)

```powershell
$env:ALLOW_AUTH_REPAIR="true"
npm run old-to-prod:repair-auth -- --apply
```

Без `ALLOW_AUTH_REPAIR=true` `--apply` отказывается (`exit 7`). Скрипт:
- работает ТОЛЬКО с `PROD_SUPABASE_DB_URL`;
- проверяет существование каждой колонки в `auth.users` через `information_schema` перед UPDATE;
- `UPDATE auth.users SET <col> = '' WHERE <col> IS NULL` для каждой существующей колонки;
- НЕ трогает `encrypted_password`, `email`, `id`, `raw_*_meta_data`;
- не печатает значения колонок — только counts.

### После apply

```powershell
npm run old-to-prod:verify-auth
```

Должно дать `AUTH_VERIFY_OK` (если `MIGRATION_SMOKE_*` задан и login проходит) или `AUTH_VERIFY_OK_WITH_WARNINGS`.

### Почему targeted repair, а не повторный import

Полный `--clean-prod --clean-auth` import пере-зальёт ~480k public-строк (~20 мин) ради фикса 33 auth-строк. `10_repair_prod_auth_tokens` меняет ТОЛЬКО NULL-token-поля на уже импортированных auth.users — секунды, без касания public-данных, без повторного clean.

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
