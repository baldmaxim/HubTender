# HUBTender RC2 — Staging Acceptance Report (этап 3.2)

## 1–2. Идентичность

- **RC1 base**: `41b7e7f` (662f50b + release-фиксы 3.1)
- **Integrated origin/main**: `a9570912e4fece5ddb5545c89ac822cf9bb6b5c2` (44 коммита после merge-base `952d729`)
- **RC2 merge commit**: `b8c2aef` (`git merge --no-ff origin/main`, без squash/rebase)
- **Ветка**: `release/hubtender-rc2-staging`
- **Ancestry**: `41b7e7f∈HEAD` PASS, `origin/main∈HEAD` PASS, все milestone-коммиты 0–2.6 PASS.

## 3. Merge: конфликты и решения

origin/main принёс сверх ожиданий этапа 3.1: фичу **«Проверка данных»** (16 правил, вердикты, экспорт, миграция `2026_07_quality_acknowledgements.sql`) — конкурирующую с релизной аналитикой качества на том же пути `GET /tenders/{id}/quality`; серию **ФП снижение/обнуление** (`2026_07_fi_discounts*.sql`); **insurance distribute-флаг** (`2026_07_insurance_distribute_flag.sql`); смену семантики количества в шаблонах (6e8ea39); lazy-роуты и мобильные оптимизации.

**Ключевое решение (коллизия `/quality`)**: контракт main сохранён как прод (страница «Проверка данных», handlers/services/repo `Quality*`); релизная аналитика этапа 2.1 переименована в `QualityAnalytics*` и переехала на **`GET /api/v1/tenders/{id}/quality-analytics`** (новые файлы `handlers/quality_analytics.go`, `services/quality_analytics.go`, `src/lib/api/qualityAnalytics.ts`; фронтовый путь страницы `/analytics/quality` не менялся). Пакетные коллизии: `SeverityWarning` → релизная константа переименована в `SeverityWarn`; `QualityRepo` → релизный `QualityAnalyticsRepo`.

| Файл | main | release | Итог | Regression |
|---|---|---|---|---|
| `backend/internal/handlers/quality.go` + `services/quality.go` + `lib/api/quality.ts` | «Проверка данных» | аналитика 2.1 | main остаётся; релиз → `*_analytics`-файлы | `quality_test.go` (analytics), `rules_test.go` (main), E2E |
| `backend/cmd/server/{routes,wire}.go` (авто-merge с дублями) | `/quality`=GetReport | `/quality`=TenderQuality | main `/quality`; релиз `/quality-analytics`; дубли wiring разведены | chi duplicate-route panic отсутствует (startup в rehearsal/e2e); route-dup grep = 0 |
| `repository/template_insert.go` (+`template_amount.go`) | 4c: количество привязанного материала ОТ РАБОТЫ (6e8ea39) | fail-closed `planTemplateRow` (FX, parent integrity) | релизная структура + семантика main: `quantities[]` два прохода → `planTemplateRow(..., quantity, ...)`; BaseQty только у непривязанного | `template_parent_test.go` (обновлён), `template_insert_integration_test.go`, unit `template_amount_test.go` |
| `repository/insurance.go` + `lib/api/insurance.ts` | `distribute_to_rows` | server `insurance_total` | оба поля | integration insurance |
| `repository/redistribution_prepared.go` (post-merge fix) | флаг гейтит client-pipeline разнос | сервер считает разнос | **сервер гейтит**: `distribute_to_rows=false` → nil-страхование в prepared-пайплайне (итог ФП не затронут — отдельный путь `tender_recalc.go`) | `redistribution_prepared_integration_test.go` + rehearsal |
| `Commerce.tsx` + `useCommerceData.ts` | client pipeline + `effInsurance`/`distributeToRows`, `isTabActive` keep-alive | server-prepared потребление + 0-F2 export-гейты | server-prepared (инвариант «no client redistribution math») + display-гейт `effInsurance` + export-гейты релиза + сигнатура main | guards `noClientPreparedRedistribution`, `redistributionConsumptionState`; E2E |
| `CostRedistribution.tsx` | флаг в client preview | server prepared + `isPreview` | оба: preview гейтится флагом, server prepared авторитетен (и сам гейтит) | guard + E2E |
| `App.tsx`, `users.ts`, `menuItems.tsx` | lazy-роуты, `/data-quality` | 7 страниц релиза | база main + релизные страницы lazy; ALL_PAGES/PAGE_LABELS — обе фичи | tsc, ESLint, E2E navigation |
| `PositionItems.tsx`, `PositionCardList.tsx` | `PositionItemsRoute` (deep-link пропом), memo-инварианты | deep-link из router | main (deep-link сохранён через обёртку) | E2E deep-link |
| `db/yandex/sql/{03,05,06}` | quality_acknowledgements, fi_discounts, insurance flag | AI/memory/FK-блоки | объединение (both) | schema equivalence gate |

Приоритеты A–F задания соблюдены: mobile/UX main сохранены; финансовые/аналитические/AI-маршруты релиза сохранены; role-гейты сохранены; CORS Cache-Control (4f42316) вошёл; retired endpoints не реанимированы; recovery/revisions/emergency off/analytics/Review Pack на месте.

**Merge-специфичные фиксы** (минимальные, перечислены полностью): переименование `QualityAnalytics*`/`SeverityWarn`; порт 4c-семантики в `planTemplateRow`; серверный гейт `distribute_to_rows` в `loadInsuranceInput`; gofmt 4 файлов. Продуктовая логика main не менялась.

**Замечание**: `backend/cmd/server/routes_test.go` теперь TRACKED-файл origin/main (владелец закоммитил) — вошёл в merge штатно; untracked WIP из пользовательского worktree не использовался.

## 4. Merge source audit (§4)

Все 17 пунктов PASS: 8 analytics-маршрутов; 21 admin-AI маршрут внутри `RequireRoles(AIAdminRoles)`; rollout/emergency/evaluate; recovery hook+scan (`main.go`); financial revision CAS; smart import + memory (8 маршрутов); review-report.xlsx; PositionItems (deep link/focus/mobile/nullable — через `PositionItemsRoute`); меню: Quality(аналитика)+Проверка данных+Benchmark+Source+Action Plan+Change Impact+Review Pack+AI Administration; дублей маршрутов 0; tombstone `bulk-commercial` жив; rollout default off (seed не менялся); OpenRouter key backend-only; PWA: `/api/` NetworkOnly + `cleanupOutdatedCaches` (финансовые ответы не кэшируются, старые чанки вычищаются).

## 5. Артефакты и fingerprint

RC2-манифесты в `artifacts/release/` (`rc2-*`), fingerprint пересчитан генератором `gen-release-manifest.mjs` (старый RC1-fingerprint `7d6f3d80…` не переиспользуется). Итоговые значения — в release-манифесте и финальном отчёте сессии.

## 6. Локальная приёмка RC2 — все гейты PASS

| Гейт | Результат |
|---|---|
| gofmt (LF) merged-файлов / go build / go vet | PASS (4 файла доформатированы в staging-fix коммите) |
| Fresh rehearsal (миграции ×2 idempotent, полный `go test -p 1 ./...` с disposable PG17, readiness audit) | **PASSED** — после 3 merge-фиксов ниже |
| Upgrade rehearsal (schema main + текущая цепочка + повторное применение) | **PASSED** |
| Schema equivalence (fresh vs upgrade, 27 инкременталов) | **PASS** |
| Race detector (golang:1.23, CGO, full + targeted DB) | **PASSED**, 0 data race |
| `tsc --noEmit` / ESLint `--max-warnings 0` | PASS |
| Canonical production build | PASS |
| Guards | **38/38 PASS** (smartImportFrontendPolicy — LF-verified: CRLF-checkout false-fail) |
| Browser smoke (production bundle + fake OpenRouter) | **17 passed / 0 failed (1.5m)**; console/page errors 0; провайдерских вызовов ровно 5; rollout off после прогона |
| Docker image `hubtender:staging-b8c2aef` | 31.4MB; startup: health/db/recalc/ai — 200; `/api/v1/quality/rules` auth-гейт (401); rollout `nomenclature_rerank=off`; секреты в образ не запечены |
| Secret scan merge-диапазона (41b7e7f..HEAD) | PASS (ключей/JWT/DSN нет) |

**Merge-выявленные фиксы** (все — release-blocking класс, минимальные, с regression):
1. `repository/insurance.go`: `--theirs` при разрешении потерял релизную семантику Upsert (валидация calc → один tx: revision bump → upsert → синхронный `RecalculateTenderGrandTotalTx` → success-CAS; на main это делали SQL-триггеры, в релизе выведенные). Файл пересобран: релизная семантика + `distribute_to_rows` main. Regression: `TestCachedGrandTotal_InsuranceUpsertRecalculatesSynchronously`, `TestRevisionIntegration_RedistributionMarker` (оба падали → PASS).
2. `template_insert_integration_test.go`: ожидание приведено к продовой семантике 6e8ea39 (количество привязанного материала от работы×расход: child total 120, не 100).
3. Новый regression-тест `TestPreparedRedistribution_DistributeToRowsOffSkipsInsurance` — серверный гейт флага в prepared-пайплайне.
4. `src/lib/quality/dashboardPolicy.ts` — импорт типов на `qualityAnalytics` (tsc ловил).

## 7. Supply chain

- **govulncheck** (golang:1.25 disposable-контейнер): исходно **5 достижимых** уязвимостей (golang-jwt/v5 — auth header DoS; excelize — парсинг пользовательских XLSX; pgx/v5; x/net; x/text). Выполнено **минимальное целевое обновление** этих 5 модулей до fixed-версий (без массовых upgrade): jwt v5.2.2, pgx v5.9.2, excelize v2.11.0, x/net v0.56.0, x/text v0.39.0; go-директива поднялась до 1.25 → builder-образ Dockerfile и race-контейнер переведены на golang:1.25. **Полный regression-гейт после обновлений повторён целиком**: govulncheck → **0 vulnerabilities**; fresh+upgrade rehearsal PASSED; race PASSED; smoke 17/17; образ пересобран и startup-проверен (health×4=200, rollout off).
- **npm audit --omit=dev**: 3 high, все классифицированы unreachable в production runtime (fast-uri — build-tooling цепочка внутри @ant-design/charts; react-router CSRF — только RSC-режим, приложение чистый SPA). Изменений npm-зависимостей не делалось; backlog: bump react-router-dom ≥8.3.0 отдельным изменением. Детали: `artifacts/release/rc2-supply-chain-summary.json`.
- Legacy Supabase anon-key в `scripts/archive/` — pre-existing; активность старого проекта установить локально нельзя → **manual gate: ротация/зачистка на стороне владельца** (старый Supabase prod ещё живой — не игнорировать).

## 8. Staging bootstrap (итерация 2: owner прислал директиву с approvals)

**Release freeze подтверждён**: worktree чист на `0bffa67`, ancestry (41b7e7f, a957091, 662f50b) — PASS, origin/main не сдвинулся (drift 0, RC3 не требуется).

**Generic staging package создан и закоммичен** (без секретов):
- `deploy/staging/docker-compose.staging.yml` — изолированный проект `hubtender-staging` (своя сеть/volumes, db без внешнего порта, api только за proxy, immutable `${STAGING_IMAGE}`, memory-limits для isolated_same_host), migration one-shot профиль (baseline+incrementals ×2, guard на «staging» в имени БД);
- `deploy/staging/Caddyfile.staging` — TLS, HSTS, `/api|/ws|/health` → api, source maps 404, no-cache index.html / immutable assets;
- `deploy/staging/.env.staging.example` — только placeholder'ы; `deploy/staging/README.md` — runbook (обе топологии);
- `scripts/staging/`: `lib-guards.sh` (отказ при БД без «staging», prod-DSN, APP_ENV≠staging), `deploy-staging.sh` (freeze-проверка SHA, migrate → api → build dist из того же SHA → web → health), `health-check-staging.sh`, `backup-staging.sh` (SHA-256, retention 7), `restore-test-staging.sh` (restore в disposable `*_restore_test`, counts, rollout=off), `seed-staging-users.sh` (bcrypt через `caddy hash-password`, идемпотентно, APP_ENV=staging guard, синтетический STAGING-SYNTH-001), `rollback-staging.sh` (frontend/backend/ai-off по политике RC1_ROLLBACK), `cleanup-staging.sh`.

**First-install dry-runs на замороженном HEAD** (§6): fresh — **PASSED** (миграции ×2, полный suite, readiness, rollout off, FK, tombstones); synthetic upgrade — **PASSED** (legacy-данные, audit выявил рисковые строки, remediation только в test DB, повторное применение). Артефакты: `artifacts/staging/{fresh,upgrade}-dry-run.{json,log}`.

## 9–23. Actual provision/push/deploy/acceptance

**НЕ ВЫПОЛНЯЛИСЬ — STAGING INPUTS INCOMPLETE.** В окружении сессии не установлена НИ ОДНА `STAGING_*`-переменная, а в присланной директиве все подключение-критичные значения — литеральные `...`-плейсхолдеры: `STAGING_SSH_TARGET`, `STAGING_PUBLIC_URL`, `STAGING_API_URL`, `STAGING_REGISTRY`, `STAGING_IMAGE_REPOSITORY`, `STAGING_DB_HOST/PORT/USER/PASSWORD`, `STAGING_JWT_SECRET`, все 6 test-user переменных. Также отсутствуют owner-gates данных: `STAGING_MARKUP_BACKFILL_REVIEWED`, `STAGING_RELATION_PREFLIGHT_APPROVED` (для first-install пустой БД оба вакуумны, но требуются явно). Без реальных значений provision/push/deploy запрещены §0; деплой локальным Docker не имитировался.

## 24. Вердикт

**STAGING INPUTS INCOMPLETE** — этап 3.2 НЕ завершён. Всё, что выполнимо без staging-значений, сделано: RC2 заморожен и перепроверен, staging package готов к развёртыванию (runbook — `deploy/staging/README.md`), dry-runs зелёные. Следующий шаг владельца: заполнить `STAGING_*`-значения (env или `.env.staging` на staging host по шаблону) + два data-gate подтверждения → повторный проход выполнит push, publish, actual migration, deploy и полную приёмку (§9–23) по этому же runbook.
