# HUBTender RC1 — Migration Manifest

- **Commit**: `662f50b`
- **Порядок применения**: лексикографический glob `db/yandex/incremental/*.sql` (так применяет и rehearsal-скрипт `scripts/readiness/run-production-rehearsal.sh`, и ручной deploy по DEPLOY.md). Имена датированы (`YYYY_MM_*`), внутри месяца порядок алфавитный — все миграции этого релиза взаимно независимы по порядку внутри месяца, кроме явных зависимостей ниже.
- **Baseline**: `db/yandex/sql/00–90*.sql` — полная сборка схемы с нуля; синхронизирован с incremental-цепочкой (проверяется schema-equivalence-гейтом, см. `artifacts/release/schema-equivalence-summary.json`).
- **Rehearsal-подтверждение**: fresh install (baseline + incrementals ×2 — идемпотентность) и upgrade rehearsal (pre-upgrade schema из git + synthetic legacy data + цепочка + повторное применение) — оба сценария на disposable PostgreSQL 17 в Docker, имя БД содержит `test`, случайный порт, cleanup trap.

## Состояние относительно production

Yandex Managed PostgreSQL уже содержит все миграции по `2026_06_*` включительно, а также `2026_07_client_positions_rich_runs.sql` (деплой strikethrough) — сверить фактическое состояние перед деплоем (preflight-запросы ниже). **Новые для production — 10 миграций release-диапазона** (отмечены ★; 9 из этапов 0–2.6 + 1 добавлена RC1-гейтом эквивалентности схемы).

### Release-blocking фиксы RC1 (этап 3.1)

1. **Порядок AI-миграций**: `2026_07_ai_controlled_rollout.sql` → переименована в `2026_07_ai_rollout_controlled.sql` (делала `ALTER TABLE ai_feature_settings` до создающей миграции; upgrade rehearsal падал). Regression-guard: `scripts/checks/migrationOrder.check.mjs`.
2. **Baseline gap client_positions**: колонки `section_number`/`position_name` были добавлены в baseline (19c40f5) без инкрементальной миграции → путь «schema из git + chain» собирал БД без колонок, которые читает prepared-redistribution. Добавлена ★-миграция `2026_07_client_positions_section_fields.sql` (на production — no-op: колонки там уже есть).
3. **Baseline выровнен с цепочкой** (schema equivalence): имена 11 FK (`ai_*`, `nomenclature_import_aliases_*`) приведены к именам, которые создаёт миграционная цепочка; 8 inline per-column CHECK на `ai_feature_settings` заменены на те же именованные констрейнты, что добавляет `2026_07_ai_rollout_controlled.sql` (`rollout_mode_chk`, `rollout_limits_chk`). Гейт: `scripts/readiness/schema-equivalence.sh` → PASS.

## Инвентарь: release-диапазон (★ применять при деплое RC1)

### ★ 2026_07_financial_calculation_revision.sql — этап 0-F2
- **Назначение**: revision-модель финансового расчёта (`financial_input_revision`, `financial_calculation_revision`, status/started_at) на `tenders`.
- **Lock**: `ALTER TABLE tenders ADD COLUMN ... DEFAULT` — короткий ACCESS EXCLUSIVE; PG17 без table rewrite.
- **Данные**: инициализация ревизий существующих тендеров (idempotent, guarded).
- **Preflight**: `SELECT count(*) FROM information_schema.columns WHERE table_name='tenders' AND column_name='financial_input_revision';` → 0 до, 1 после.
- **Rollback**: не откатывать (колонки безвредны для старого кода); см. ROLLBACK manifest.
- **Manual gate**: нет.

### ★ 2026_07_retire_bulk_update_commercial_costs.sql — этап 0.1.2.2c
- **Назначение**: fail-closed tombstone вместо legacy RPC `bulk_update_boq_items_commercial_costs` (DROP + CREATE OR REPLACE, RAISE EXCEPTION).
- **Lock**: только function DDL — мгновенно.
- **Порядок**: строго ПОСЛЕ деплоя backend, который больше не зовёт RPC (в этом релизе backend уже таков; при rolling-окне старый backend, зовущий RPC, получит exception → fail-closed, не тихая порча).
- **Verification**: вызов RPC → `ERROR: ... retired`.
- **Rollback**: НЕ восстанавливать исходную функцию (unsafe writer). Roll-forward only.
- **Manual gate**: подтвердить, что никакие внешние скрипты не зовут RPC.

### ★ 2026_07_retire_save_redistribution_results.sql — этап 0.1.2.3a
- Аналогично предыдущей: tombstone для `save_redistribution_results`; + audit-запись о retirement (INSERT, `ON CONFLICT`-guarded). Rollback: roll-forward only.

### ★ 2026_07_retire_sql_grand_total_recalc.sql — этап 0.1.2.4a
- **Назначение**: вывод SQL-формулы grand-total: DROP 4 функций/триггеров, tombstone; единственный источник — `backend/internal/calc`.
- **Порядок**: ПОСЛЕ backend-деплоя этого релиза (старый backend полагался на триггеры → окно rolling-совместимости см. DEPLOYMENT manifest).
- **Verification**: `SELECT proname FROM pg_proc WHERE proname LIKE '%grand_total%';` → только tombstone.
- **Rollback**: roll-forward only.

### ★ 2026_07_boq_quote_source_dates.sql — этап 1.3
- **Назначение**: `boq_items.quote_date`, `quote_checked_at` (nullable, metadata-only, не двигают ревизию).
- **Lock**: короткий; nullable-колонки без default rewrite. Idempotent (`IF NOT EXISTS`).
- **Rollback**: колонки безвредны; не откатывать.

### ★ 2026_07_boq_relation_integrity.sql — этап 2.4 §8
- **Назначение**: составные FK (tender_id, position_id) против cross-tender/cross-position связей.
- **Механика**: `ADD CONSTRAINT ... NOT VALID` (5 шт.) → `VALIDATE CONSTRAINT` (2 шт.) — валидация без длинного ACCESS EXCLUSIVE (SHARE UPDATE EXCLUSIVE на VALIDATE).
- **Preflight (обязателен)**: до применения выполнить контрольные SELECT на orphan-строки (в заголовке миграции); при ненулевом результате — согласованная remediation (upgrade rehearsal репетирует именно это).
- **Manual production gate: ДА** — проверка реальных данных на нарушения FK до VALIDATE.
- **Rollback**: `DROP CONSTRAINT` безопасен (ослабляет защиту, не ломает данные).

### ★ 2026_07_client_positions_section_fields.sql — этап 3.1 (RC1 fix)
- **Назначение**: `client_positions.section_number`, `position_name` (nullable, additive). Закрывает baseline gap 19c40f5: production колонки уже содержит (миграция там no-op `IF NOT EXISTS`), но любой путь «schema из git + chain» их терял, а `repository/redistribution_prepared.go` их читает.
- **Lock**: короткий; nullable без default-rewrite. Idempotent.
- **Rollback**: не откатывать (колонки использует prepared redistribution).

### ★ 2026_07_smart_import_memory.sql — этап 2.3
- **Назначение**: `import_mapping_profiles`, `import_nomenclature_aliases` (+5 индексов). Никаких financial-полей/байтов workbook.
- **Lock**: только CREATE — безопасно. Idempotent.
- **Rollback**: DROP TABLE безопасен (потеря памяти импорта, не финансовых данных).

### ★ 2026_07_ai_feature_settings.sql — этап 2.5
- **Назначение**: `ai_feature_settings` (одна строка на feature_code); **API-ключ НЕ хранится** (только env). Seed-строка `nomenclature_rerank` с выключенным состоянием.
- **Verification**: `SELECT enabled FROM ai_feature_settings WHERE feature_code='nomenclature_rerank';` → `false`.
- **Rollback**: DROP TABLE безопасен.

### ★ 2026_07_ai_rollout_controlled.sql — этап 2.6
- **Назначение**: rollout-состояние, пилотные пользователи, квоты, бюджет-резервации, circuit breaker, evaluations, feedback (5 таблиц, 7 индексов, ALTER `ai_feature_settings`).
- **Безопасный default**: seed `rollout_mode='off'`; режима general availability в схеме НЕТ (CHECK-констрейнт).
- **Порядок**: строго ПОСЛЕ `2026_07_ai_feature_settings.sql` (делает `ALTER TABLE ai_feature_settings`). **Release-blocking фикс RC1**: исходное имя `2026_07_ai_controlled_rollout.sql` сортировалось РАНЬШЕ создающей миграции → upgrade rehearsal падал (`relation "public.ai_feature_settings" does not exist`; fresh-сценарий маскировал — таблица приходила из baseline). Файл переименован; regression-guard: `scripts/checks/migrationOrder.check.mjs` (chain-owned таблицы не могут упоминаться раньше создающего файла).
- **Verification**: `SELECT rollout_mode FROM ai_feature_settings WHERE feature_code='nomenclature_rerank';` → `off`.
- **Rollback**: emergency off — операционный (API), не миграционный; DROP таблиц теряет только AI-телеметрию.

## Инвентарь: pre-range (уже должны быть в production — только preflight-сверка)

| Миграция | Назначение | Preflight-сверка в prod |
|---|---|---|
| 2026_05_app_auth_runtime.sql | app-auth runtime (JWT, refresh) | таблицы auth-домена существуют |
| 2026_05_fix_extensions_schema_defaults.sql | extensions schema | — |
| 2026_06_boq_grand_total_skip_guard.sql | GUC-guard пересчёта | — |
| 2026_06_ccv_dedup_unique.sql | дедуп CCV + unique idx | idx существует |
| 2026_06_clone_skip_grand_total_aux.sql | clone-путь без aux-пересчёта | — |
| 2026_06_financial_approval.sql | согласование расчёта | колонки approval существуют |
| 2026_06_global_pgnotify.sql / tender_scoped / timeline_pgnotify | LISTEN/NOTIFY топология | триггеры notify существуют |
| 2026_06_tender_registry_dedupe.sql | дедуп tender_registry + guard | guard-триггер существует |
| 2026_06_timeline_canonicalize.sql | canonical anchor timeline | — |
| 2026_07_client_positions_rich_runs.sql | strikethrough rich_runs (задеплоено 2026-06) | колонка существует |
| 2026_07_markup_multiplyformat_backfill.sql | **P0 backfill** operandNMultiplyFormat (multiply+markup → явный 'addOne'/'direct') | `SELECT count(*) FROM markup_tactics WHERE sequences::text LIKE '%multiply%' AND sequences::text NOT LIKE '%MultiplyFormat%';` → 0 |

**Manual gate (multiplyFormat)**: перед деплоем выполнить readiness markup-impact отчёт (`backend/cmd/production-readiness-audit`) — список тактик/тендеров, чьи суммы изменит исправленный дефолт, отдаётся владельцу на согласование.

## Seed / test-only

- Production seed: только строки внутри миграций (`ai_feature_settings`, `ai_nomenclature_rollout` c `off`, tombstone-audit) — все idempotent (`ON CONFLICT`/guards).
- Test-only seed живёт в rehearsal/e2e-скриптах (`seed_minimum`, `tests/readiness/fixtures`) и в миграции НЕ входит.
- Duplicate migration names: нет (проверено `ls | sort | uniq -d` — пусто).
- Tombstones: 3 retired-функции оставлены как RAISE-заглушки намеренно (fail-closed, обнаружение забытых вызовов).

## Transaction boundaries

Каждый файл применяется одним `psql -f` (single transaction по умолчанию для DO/DDL-блоков внутри; файлы не содержат `BEGIN/COMMIT`-разрывов, кроме NOT VALID/VALIDATE-пар, которые сознательно разделены). Idempotency подтверждена двойным применением в rehearsal.

## Итог проверок (см. release report)

1. Fresh baseline == baseline+incrementals — schema equivalence gate.
2. Incremental chain на pre-upgrade схеме — upgrade rehearsal.
3. Реальный порядок применения = lexicographic glob — тот же в rehearsal и деплое.
4. Random-order риск: отсутствует (runner один, порядок детерминирован).
5. Unsafe production default: отсутствует — rollout seed `off`, AI выключен.
