# Production Readiness — pre-deploy checklist (этап 2.4)

Воспроизводимый порядок подготовки и проверки деплоя HUBTender.
Секретов в этом документе нет и быть не должно.

> Этап 2.5: AI-администрирование OpenRouter
> ([OPENROUTER_AI_ADMINISTRATION.md](OPENROUTER_AI_ADMINISTRATION.md)).
> `OPENROUTER_API_KEY` — опциональный server secret: без него приложение
> стартует, AI-статус `not_configured`. Пользовательские AI-вызовы выключены
> rollout'ом до этапа 2.6 — деплой 2.5 не меняет поведение Smart Import для
> пользователей. Guard: `openRouterAdministrationSafety.check.mjs`.

## 1. Порядок application rollout

1. Прогнать локальные gates (см. §20 этапа): build/vet/tests/tsc/lint/guards.
2. `bash scripts/readiness/run-production-rehearsal.sh` (fresh install).
3. `bash scripts/readiness/run-production-rehearsal.sh --upgrade` (upgrade rehearsal).
4. `bash scripts/readiness/run-race-detector.sh` (race, Linux/CGO контейнер).
5. `bash scripts/readiness/run-browser-smoke.sh` (browser smoke против production bundle).
6. Readiness audit против production (read-only): см. §4.
7. Backup (см. §3) → DB migrations (§2) → выкладка backend → выкладка frontend.
8. Post-deploy checks (§13).

## 2. Порядок DB migrations

- Каталог: `db/yandex/incremental/*.sql` — применяются по алфавиту, все idempotent.
- `2026_07_boq_relation_integrity.sql` НАЧИНАЕТСЯ с read-only preflight и
  падает с понятной ошибкой при повреждённых данных (cross-tender/cross-scope
  связи). Повреждённые строки НЕ исправляются автоматически — см. §6.
- `2026_07_markup_multiplyformat_backfill.sql` применять ТОЛЬКО после review
  impact-отчёта (§5).
- Down-миграций нет намеренно (unsafe down path отсутствует) — rollback см. §14.

## 3. Backup/restore responsibility

- Перед миграциями: снапшот Yandex Managed PostgreSQL (консоль/CLI владельца
  инфраструктуры). Ответственный: владелец production-БД.
- Restore-процедура: штатное восстановление снапшота Managed PG. Приложение
  откатывается на предыдущий образ (см. §14) ДО restore, чтобы новые записи не
  писались в старую схему.

## 4. Readiness audit command

```bash
# read-only; ничего не изменяет; exit 1 при blockers
DATABASE_URL='<prod-dsn-от-владельца>' \
  go run -C backend ./cmd/production-readiness-audit --json-out readiness.json
```

Флаги: `--tender <uuid>`, `--batch-size`, `--calculating-timeout-minutes`,
`--fail-on-warning`, `--skip-markup-impact`, `--skip-acl`.
Отчёт redacted (UUID+коды+счётчики+дельты), детерминированный fingerprint.

## 5. Markup backfill review

- В JSON-отчёте блок `markup_backfill_impact`: tactic ID/name, category, step,
  operand, planned `addOne`, связанные тендеры со статусами/approval,
  диагностическая дельта (фиксированный вход base=1000, markup=10% — НЕ
  финансовый итог тендера).
- Gate: **zero affected rows** ЛИБО owner-reviewed список затронутых тактик.
  Без review backfill не применять. Политика `addOne` не пересматривается без
  нового бизнес-решения.

## 6. Legacy tender consistency policy

- Blockers аудита (`cross_tender_position`, `cross_scope_parent`, `self_parent`,
  `parent_non_work`, `approved_not_current`, `stuck_calculating`, `missing_fx`)
  разбираются вручную ДО миграции целостности.
- Documented remediation (только после review, вручную):
  - застрявший calculating / невалидный approval:
    `UPDATE public.tenders SET financial_approved=false, financial_approved_by=NULL,
     financial_approved_at=NULL, financial_calculation_status='stale',
     financial_calculation_started_at=NULL WHERE id='<uuid>';`
    (после деплоя recovery пересчитает такой тендер сам);
  - `boq_total_mismatch`/`cached_grand_total_mismatch` — исправляется штатным
    пересчётом (после деплоя recovery/пересчёт по stale), НЕ ручным UPDATE итогов;
  - cross-tender/cross-scope строки — решение владельца данных по каждой строке
    (перенос/удаление); автоматического repair-all нет намеренно.

## 7. Stale/calculating recovery

- `FinancialCalculationRecoveryService`: один скан после startup + периодически.
- Env: `RECALC_RECOVERY_ENABLED` (default true),
  `RECALC_RECOVERY_SCAN_INTERVAL` (default 60s),
  `RECALC_RECOVERY_CALCULATING_TIMEOUT` (default 10m),
  `RECALC_RECOVERY_BATCH_SIZE` (default 100).
- stale → enqueue; calculating старше timeout при СВОБОДНОМ advisory lock →
  атомарный reclaim в stale + enqueue; failed НЕ ретраится автоматически
  (новая мутация переводит в stale). Multi-instance-safe (try-advisory-lock + CAS).
- Диагностика: `GET /health/recalc` — stale/calculating/failed counts, возраст
  старейших, последний скан/ошибка.

## 8. Race command

```bash
bash scripts/readiness/run-race-detector.sh
# = CGO_ENABLED=1 go test -race -p 1 ./...  (полный unit-слой)
# + targeted DB concurrency suite (queue/recovery/revisions/import/analytics)
```

## 9. Frontend production build

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```
`tsc --noEmit` НЕ является заменой production build. Основные чанки фиксируются
в отчёте этапа (index ≈1.31MB, vendor-antd ≈1.30MB, vendor-xlsx ≈1.0MB,
vendor-charts ≈0.2MB, vendor-react ≈0.18MB + PWA precache).

## 10. Browser smoke

```bash
bash scripts/readiness/run-browser-smoke.sh
```
Критический путь: login → тендер → Smart Import XLSX → stale→calculated →
approve-гейт (409 при stale, успех после) → recovery потерянного enqueue →
FX-изменение → очистка nullable parent (реальный NULL) → 6 аналитик →
скачивание Review Pack XLSX → отсутствие console errors/failed requests.

## 11. ACL verification

Часть readiness audit (`acl:*`): retired RPC (маркер, INVOKER, без
PUBLIC/non-owner EXECUTE), отсутствие grand-total триггеров, прямые
UPDATE/INSERT/DELETE-гранты на критические таблицы, PostgREST/Supabase роли.
Статусы: CONFIRMED_SAFE / CONFIRMED_RISK / **UNKNOWN — обязательный ручной
пункт** (например, наличие грантов у app-роли легитимно — подтвердить вручную).
Автоматический revoke не выполняется.

## 12. Feature flags

- Smart Import: встроен в «Позиции заказчика» (без отдельного флага).
- AI suggestions: `AI_NOMENCLATURE_ENABLED` — **disabled/provider-neutral**;
  реальный adapter не реализован, enabled принудительно сбрасывается (см.
  docs/AI_NOMENCLATURE_MATCHING.md). Не включать без отдельного этапа.
- Import Memory: активна всегда, строго user-scoped (docs/SMART_IMPORT_MEMORY.md).
- Recovery: `RECALC_RECOVERY_ENABLED` (см. §7).

## 13. Post-deploy checks

- `GET /health`, `/health/db`, `/health/recalc`:
  - `stale_count` → 0 в течение нескольких сканов;
  - `oldest_stale_age_seconds` не растёт монотонно;
  - `calculating_count` кратковременный; возраст < timeout;
  - `failed_count` = 0 (иначе смотреть error_code конкретного тендера).
- Логи backend: `recalc_recovery_scan` (enqueue_failed_count=0),
  `commercial recalc failed` отсутствуют.
- 409-показатели (FINANCIAL_CALCULATION_NOT_READY / ETag PreconditionFailed) —
  без всплеска относительно до-деплойного уровня.
- Импорт: `boq_import_*` операции без ошибок; import failures = 0.
- Sentry/браузер: отсутствие новых frontend-ошибок (помнить про слепую зону
  499 — тишина ≠ здоровье, проверить активные страницы вручную).

## 14. Rollback policy

- Application rollback: предыдущий Docker-образ backend + предыдущий bundle
  frontend (артефакты хранятся у владельца деплоя).
- Migrations: unsafe down path отсутствует. Новые объекты этапа 2.4 обратимо
  совместимы со старым кодом: составные FK/UNIQUE и recovery-хелперы не
  требуются старой версии приложения. При критической необходимости constraints
  снимаются вручную (`ALTER TABLE ... DROP CONSTRAINT boq_items_parent_scope_fkey,
  boq_items_position_scope_fkey, ...`) — только решением владельца.
- Retired SQL writers (bulk_update_boq_items_commercial_costs,
  save_redistribution_results, grand-total триггеры) НЕ возвращаются ни при
  каком rollback.

## 15. Manual production decisions (UNKNOWN-гейты)

1. `markup_backfill_impact` — список затронутых тактик утверждает владелец.
2. Пересчёт существующих calculated-тендеров (revision 0/0 с расхождениями из
   `legacy_zero_revision_inconsistent`) — запускать ли массовый recalc и когда.
3. Все `acl:*` пункты со статусом UNKNOWN (гранты app-роли, наличие
   PostgREST-ролей) — подтверждение вручную у владельца БД.
4. Remediation конкретных cross-tender/cross-scope строк (§6).
5. Prod-DSN для readiness audit выдаёт владелец; команда read-only.
