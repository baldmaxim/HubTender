# HUBTender RC1 — Release Notes

- **Release fingerprint**: база `662f50b4827db4585b67dc1f7c39ad17d9ad780d` (29 коммитов этапов 0–2.6 поверх `952d729`) + один release-коммит (доки и фиксы миграций, §11a); ветка `release/hubtender-rc1`. Точный RC HEAD и content-fingerprint — `artifacts/release/release-manifest.json`.
- Machine-readable: `artifacts/release/release-manifest.json` (не коммитится).

## 1. Назначение релиза

Первый release candidate, объединяющий: финансовую надёжность расчётов (этапы 0–1), read-only аналитику тендера (2.1–2.2), умный импорт BOQ с памятью (2.3), production readiness (2.4) и администрирование OpenRouter с контролируемым AI-rollout (2.5–2.6). Ничего из AI не включено по умолчанию.

## 2. Основные пользовательские изменения

- Страницы аналитики тендера: «Качество расчёта», «Ценовые отклонения», «Источники цен», «План действий», «Изменения расчёта», «Отчёт для проверки» (XLSX).
- Мастер умного импорта BOQ из Excel: анализ листа, mapping колонок, сопоставление номенклатуры, память по пользователю.
- Админ-страница OpenRouter AI (только для админ-ролей): каталог моделей, тест, активация, rollout, пилот, квоты, бюджет, аварийное отключение.
- Статус финансового расчёта на тендере: актуален / stale / считается / ошибка; согласование блокируется на неактуальном расчёте.

## 3. Критические финансовые исправления

- Все derived-суммы считает только сервер (`backend/internal/calc`); SQL-формулы и клиентские записи коммерческих сумм выведены из эксплуатации fail-closed tombstone'ами.
- Отсутствующий валютный курс — ошибка, а не 0 (fail-closed FX).
- Revision-модель: конкурентные/устаревшие пересчёты не перетирают новые входы (CAS); изменение входов инвалидирует согласование.
- Recovery: потерянный enqueue и crash в `calculating` разбираются автоматически.
- Точная десятичная арифметика cached_grand_total (big.Rat, string-bind).
- P0 multiplyFormat: дефолт `addOne`, сохранённые тактики сделаны явными (backfill уже применён к prod ранее; markup-impact review — обязательный manual gate деплоя).
- Составные FK против cross-tender/cross-position BOQ-связей.

## 4. Новая аналитика (read-only)

Quality, Price Benchmark (Tukey), Price Source Freshness, Action Plan (единый снапшот REPEATABLE READ), Change Impact (exact-diff версий), Review Pack (XLSX, formula-injection-safe). Ни один модуль не пишет в финансовые данные.

## 5. Smart Import

Серверный анализ Excel (mapping, нормализация, fingerprint); execute — только через существующий authoritative-импорт; повторный execute с изменённым файлом отклоняется (409).

## 6. AI-assisted matching

Детерминированный candidate retrieval + опциональный AI rerank. Провайдер по умолчанию — Disabled. Предложение AI никогда не применяется без явного выбора инженера; ID re-валидируются при execute; на execute-фазе провайдер не вызывается. В AI уходят только нормализованные наименования (никаких цен, объёмов, тендерных ID, Excel-байтов).

## 7. OpenRouter administration

Ключ — только server env `OPENROUTER_API_KEY` (в БД/фронт не попадает). Каталог моделей, тест соединения, тест модели на образцах, draft→activate жизненный цикл настроек.

## 8. Controlled rollout

Режимы `off → evaluation → pilot_individual/pilot_bulk` (general availability отсутствует в схеме). Пилотный список, суточные квоты (20 запросов/400 строк по умолчанию), бюджетные резервации с таймаутом, circuit breaker (3 ошибки → cooldown 300 с), аварийное отключение одной кнопкой, live-оценка перед пилотом, обратная связь по строкам без хранения prompt/response.

## 9. Безопасные defaults

- rollout `off` (seed миграции + CHECK); пилотный список пуст.
- Ручное подтверждение каждого AI-предложения; детерминированный fallback при квоте/бюджете/circuit/отключении.
- `RECALC_RECOVERY_ENABLED=true` по умолчанию.
- Без `OPENROUTER_API_KEY` приложение полностью работоспособно.

## 10. Breaking / behavior changes

- `PATCH /api/v1/items/bulk-commercial` → 410 (клиентская запись коммерческих сумм запрещена).
- SQL RPC `bulk_update_boq_items_commercial_costs`, `save_redistribution_results` и SQL grand-total → RAISE-tombstones.
- Согласование расчёта сбрасывается при изменении финансовых входов.
- Markup multiply-дефолт: `addOne` (данные backfill'ены; поведение меняется только у тактик, полагавшихся на старый баг).

## 11. Migration requirements

10 новых миграций, порядок лексикографический (guard `migrationOrder.check.mjs`); FK-миграция требует data-preflight. Полный manifest: `HUBTENDER_RC1_MIGRATIONS.md`.

## 11a. Release-blocking фиксы, внесённые RC1 (этап 3.1)

1. Переименование `2026_07_ai_controlled_rollout.sql` → `2026_07_ai_rollout_controlled.sql` — миграция применялась раньше создающей `ai_feature_settings`; upgrade rehearsal падал. + regression-guard `scripts/checks/migrationOrder.check.mjs`.
2. Новая миграция `2026_07_client_positions_section_fields.sql` — baseline-gap 19c40f5 (колонки читает prepared redistribution; на production no-op).
3. Baseline (`03_tables.sql`, `06_indexes_constraints.sql`) выровнен с результатом миграционной цепочки: 11 имён FK, 8 CHECK → 2 именованных констрейнта. Новый гейт: `scripts/readiness/schema-equivalence.sh`.

Продуктовый код (Go/TS) не менялся.

## 12. Pre-deploy manual gates

1. Реальный backup prod БД.
2. Markup impact review (владелец подтверждает список затронутых тактик).
3. Production ACL review (admin AI роли).
4. Orphan-данные для FK-миграции.
5. Решение владельца о merge origin/main → release (12 mobile-коммитов).
6. AI: ключ/модель/бюджет/пилот — отдельное решение владельца (не входит в деплой RC1).

## 13. Known limitations

См. SCOPE §I: отставание от origin/main (12 коммитов), нет юнит-тестов фронта, выборочное покрытие handlers, host-OOM риск сборки, evaluation только на approved aliases, legacy anon-key в archive-скриптах (backlog).

## 14. Rollback behavior

`HUBTENDER_RC1_ROLLBACK.md`: frontend rollback всегда безопасен; backend rollback безопасен до retire-миграций, после — roll-forward; retired SQL writers не возвращаются; AI выключается мгновенно без деплоя.

## 15. Test evidence

- gofmt (LF-нормализованный): PASS; `go build`/`go vet`/`go mod verify`: PASS.
- Fresh rehearsal (disposable PG17): baseline+incrementals ×2 (идемпотентность), full `go test -p 1 ./...` с БД, readiness audit — см. `artifacts/release/rehearsal-fresh.log`.
- Upgrade rehearsal: pre-upgrade схема из main + synthetic legacy data + цепочка + повторное применение — см. `artifacts/release/rehearsal-upgrade.log`.
- Race detector (Linux/CGO контейнер): full + targeted DB concurrency — см. `artifacts/release/race.log`.
- Frontend: `tsc --noEmit` PASS, ESLint zero-warning PASS, production build PASS (`artifacts/release/frontend-build-manifest.json`).
- Browser smoke против production-бандла с fake OpenRouter: 17 passed / 0 failed (1.6m) — `artifacts/release/playwright-summary.json`.
- Guards: 38/38 PASS (37 существующих + новый `migrationOrder.check.mjs`; 3 запускаются через `npx tsx`; CRLF-checkout даёт ложные падения строковых литералов — гонять на LF или через tsx).
- Schema equivalence fresh vs upgrade: `artifacts/release/schema-equivalence-summary.json`.
- Secret scan: `artifacts/release/secret-scan-summary.json`.

## 16. Fingerprint

Commit `662f50b4827db4585b67dc1f7c39ad17d9ad780d`; content-fingerprint (SHA-256 от commit + migration hashes + lock hashes + build hashes) — в `artifacts/release/release-manifest.json`.
