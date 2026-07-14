# Этап 0 — отчёт о завершении (приёмка 2026-07-14)

Этап 0 «Единый расчётный контур» завершён (0.1.1 → 0.1.2.x → 0-F1 → 0-F2).
Следующая работа — **Tender Quality Analytics MVP**, не расчётный рефакторинг.

## 1. Закрытые критические ошибки

| # | Ошибка | Закрыто |
|---|---|---|
| 1 | Клиентские `total_amount`/commercial принимались и сохранялись (bulk-commercial RPC, redistribution save, audit rollback, copy/transfer, template insert, mass import) | 0.1.2.1–0.1.2.3b.1, 0-F1 |
| 2 | Отсутствующий валютный курс превращался в 1.0/0 | 0.1.1 + 0-F1 (fail-closed MISSING_FX_RATE везде) |
| 3 | Изменение курса не пересчитывало BOQ/commercial/итог | 0-F1 (атомарный reprize-pipeline, admin-паритет) |
| 4 | `cached_grand_total` считался SQL-функцией/триггерами по устаревшим данным, двоился со straховкой | 0.1.2.4a (+decimal-контракт 0.1.2.4a.1) |
| 5 | Binary-float округление (1.005→1.00) | 0.1.2.4a.1 (big.Rat, ::text, string-bind) |
| 6 | Старый фоновый расчёт мог перезаписать новые входы; два recalc одного тендера конкурировали | 0-F2 (advisory lock + REPEATABLE READ + revision CAS) |
| 7 | Согласование оставалось true после финансовых изменений; approve при неактуальном расчёте | 0-F2 (central invalidation + 409 FINANCIAL_CALCULATION_NOT_READY) |
| 8 | Служебный recalc сдвигал пользовательский ETag BOQ | 0-F2 (derived writer без updated_at) |
| 9 | Stale redistribution snapshot при неизменном BOQ-set | 0-F2 (revision marker, INPUT_REVISION_CHANGED) |

## 2. Действующие инварианты

- Деньги, попадающие в БД, вычисляются ТОЛЬКО `backend/internal/calc` (client
  totals — диагностика).
- `cached_grand_total`: одна формула (decimal half away from zero), один
  writer (`RecalculateTenderGrandTotalTx`), SQL-двойники — tombstones.
- Каждая пользовательская финансовая команда: +1 `financial_input_revision`
  (одна tx, один bump), status → stale, approval → false.
- Успех расчёта — только через CAS по input revision; провал CAS откатывает
  все derived-записи и re-enqueue'ит последнюю ревизию.
- Один тендер — не более одного пишущего recalc кросс-процессно.
- Approval/final export невозможны при stale/calculating/failed или
  несовпадении ревизий (backend 409 + frontend shared policy).
- `boq_items.updated_at` = только пользовательские input-изменения.

## 3. Миграции к применению (production, по порядку; НЕ применялись к prod)

1. `db/yandex/incremental/2026_07_retire_bulk_update_commercial_costs.sql` — применена ранее? см. журнал деплоя; далее только новые:
2. `db/yandex/incremental/2026_07_retire_save_redistribution_results.sql`
3. `db/yandex/incremental/2026_07_retire_sql_grand_total_recalc.sql`
4. `db/yandex/incremental/2026_07_financial_calculation_revision.sql` (0-F2)

Все инкрементальные миграции идемпотентны (проверено двойным применением на
приёмочной БД). Порядок деплоя: сначала полный rollout приложения, затем
retire-миграции (4-я — до/вместе с rollout 0-F2, т.к. код читает новые колонки:
**применить миграцию 4 ПЕРЕД деплоем бэкенда 0-F2**).

Baseline-исправление: `db/yandex/sql/03_tables.sql` — добавлены
`client_positions.section_number/position_name` (существуют на проде, были
пропущены в baseline; выявлено приёмкой).

## 4. Реально выполненные тесты (2026-07-14)

- `go test ./... -p 1` на **живой PostgreSQL 17** (Docker, `hubtender_test`):
  **364 PASS / 0 SKIP / 0 FAIL** — включая ВСЕ integration-suites этапа 0
  (import/FX, revision/CAS, конкурентные recalc, approval-гейты, ETag,
  redistribution fail-closed, rollback, copy/transfer, tombstones).
- Юнит/сервис/хендлер-тесты, golden Go↔TS parity, guard'ы (15 шт.) — PASS.
- `npx tsc --noEmit`, `npm run lint` — чисто.
- `go test -race` — NOT RUN (среда без cgo/gcc); закреплено в pre-deploy.

## 5. Оставшееся SKIPPED / NOT RUN

- `-race` — выполнить на машине с gcc (см. чеклист).
- `npm run build` локально OOM'ится (известное ограничение среды) — валидация
  через tsc+lint; собрать на CI/деплой-хосте.

## 6. Pre-deploy checklist

1. `HUBTENDER_TEST_DATABASE_URL=<изолированная test-БД> go test ./... -p 1` — 0 FAIL.
2. `CGO_ENABLED=1 go test -race ./internal/...` (машина с gcc).
3. Все guard'ы: `for g in scripts/checks/*.check.mjs; do npx tsx "$g"; done`.
4. Применить `2026_07_financial_calculation_revision.sql` к prod (идемпотентна) **до** деплоя бэкенда 0-F2.
5. Деплой backend → frontend (обычный порядок), затем retire-миграции по журналу.
6. Прод-смоук: PATCH курса (пересчёт+calculated), импорт (stale→calculated), approve-гейт 409.

## 7. Неблокирующий backlog (НЕ мешает Tender Quality Analytics MVP)

- Серверный FI breakdown (0.1.2.4b) — FI пока считает legacy TS-путь.
- Полноценные `calculation_runs` + историческое replay.
- Nullable PATCH (обнуление курса обычным PATCH).
- Составные FK (tender_id+id) для cross-tender защиты на уровне БД.
- Full decimal migration (за пределами cached_grand_total границы).
- Расширенный DB ACL-аудит; cleanup legacy/dead code (CommercialRepo.ComputeCommercialRowsForTender без потребителей, `analyzeImportMismatch` частично дублирует серверные counts).
- Отдельная tender-level audit-таблица для approval-инвалидаций (сейчас structured log).
- Индикативный `calculating`-статус виден только между claim и commit фонового recalc; для sync-путей UI его не увидит (несущественно).
