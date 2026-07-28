# HUBTender RC1 — Release Scope

- **Release**: hubtender-rc1
- **База**: `662f50b4827db4585b67dc1f7c39ad17d9ad780d` (этапы 0–2.6); **RC HEAD** — единственный release-коммит поверх неё («release: подготовить HUBTender RC1 …»: доки + 2 release-blocking фикса миграций, продуктовый код не менялся)
- **Ветка**: `release/hubtender-rc1` (создана из `feature/stage-2-6-controlled-ai-rollout` @ 662f50b)
- **База сравнения**: merge-base с `origin/main` = `952d729` (29 коммитов этапов 0–2.6)
- **Дата сборки RC**: 2026-07-17

## A. Финансовая надёжность (этапы 0–1, production readiness)

| Возможность | Коммит | Подтверждение |
|---|---|---|
| Authoritative-расчёты: все derived-суммы BOQ считает только сервер (`backend/internal/calc`) | 2623925, 13d0b46 | unit + integration (`tender_grand_total_integration_test.go`), guard `canonicalCachedGrandTotal` |
| FX fail-closed: отсутствующий курс → типизированная ошибка, не 0 | 472cf8a | `regression_fx_p0_test.go`, guards `fxGuard`, `failClosed` |
| Import authority: server-authoritative BOQ import, client total — только диагностика с mismatch report | 472cf8a | `import_fx_integration_test.go`, guard `serverAuthoritativeImportFx` |
| Financial revision-модель: ревизия расчёта на тендер, CAS-защита от stale recalc | 19c40f5 | `revision_integration_test.go`, guard `financialRevisionSafety` |
| Stale/concurrent protection: конкурентный recalc не перетирает более новую ревизию | 19c40f5 | race-suite `race_on_test.go` (repository) |
| Approval invalidation: изменение входов инвалидирует согласование | 19c40f5, миграция `2026_06_financial_approval.sql` | `revision_integration_test.go` |
| Recovery: потерянный enqueue → stale-скан; crash в `calculating` → advisory-reclaim | ed406f3 | `recalc_recovery_integration_test.go`, `recalc_recovery_test.go` |
| Decimal cached total: big.Rat-ядро, `::text`-агрегаты, string-bind записи | 13d0b46 | `money_decimal_test.go`, `cached_grand_total_test.go` |
| DB integrity: составные FK против cross-tender/cross-position связей | ed406f3, миграция `2026_07_boq_relation_integrity.sql` | `boq_relation_integrity_integration_test.go` |
| Nullable PATCH: tri-state PATCH для очистки nullable BOQ-полей | ed406f3 | `nullable_test.go`, `boq_patch_integration_test.go` |
| Retired SQL writers: commercial RPC, redistribution RPC, SQL grand-total — fail-closed tombstones | 3c7aa38, миграции `2026_07_retire_*.sql` | `*_rpc_retired_integration_test.go`, guard `noCommercialSqlRpc` |

## B. Аналитика (этап 2.1–2.2, read-only)

| Модуль | Endpoint | Коммит |
|---|---|---|
| Quality (качество расчёта) | `GET /api/v1/tenders/{id}/quality` | a33c3f8 |
| Price Benchmark (ценовые отклонения, Tukey) | `GET /api/v1/tenders/{id}/price-benchmarks` (+`/history`) | 35ff28e |
| Price Source Freshness (покрытие/актуальность quote_link) | `GET /api/v1/tenders/{id}/price-source-quality` | fae555a |
| Action Plan (единая приоритетная очередь, REPEATABLE READ снапшот) | `GET /api/v1/tenders/{id}/action-plan` | ecffd77 |
| Change Impact (exact-сравнение версий тендера) | `GET /api/v1/tenders/{id}/change-impact` | 9d51134 |
| Review Pack (XLSX-снапшот всех аналитик, formula-injection-safe) | `GET /api/v1/tenders/{id}/review-report[.xlsx]` | 0e91cd0 |

Все модули read-only: не пишут в финансовые таблицы (подтверждено guard'ами `*Safety`/`*FrontendPolicy` на каждый модуль).

## C. Автоматизация импорта (этап 2.3)

- **Smart Import** (e65f591): серверный анализ Excel (`POST .../boq-import/analyze`), mapping, нормализация, fingerprint-контроль между analyze и execute; execute идёт через существующий authoritative import-путь.
- **AI-assisted matching** (61d4cfb): детерминированный candidate retrieval + provider-neutral rerank; `DisabledProvider` по умолчанию; подтверждение инженером обязательно; re-валидация ID при execute; никакого provider-вызова в execute-фазе (guard `aiNomenclatureSafety`).
- **Import Memory** (5a0db62): персональные mapping-профили по header signature + подтверждённые nomenclature aliases (exact-применение); persistence только после успешного импорта.

## D. OpenRouter (этапы 2.5–2.6)

- **Admin catalog** (64c6847): статус/тест соединения, каталог моделей с refresh, настройки nomenclature-модели (draft → test → activate → deactivate).
- **Model test**: `POST /api/v1/admin/ai/nomenclature/test-model` — тест на образцах до активации.
- **Controlled rollout** (662f50b): режимы `off → pilot`, пилотные пользователи, транзишены только через явный admin-запрос.
- **Quotas**: per-user/суточные квоты пилота; исчерпание → детерминированный fallback без AI.
- **Budget**: бюджетная резервация на вызов, недоступность бюджета → fail-closed.
- **Circuit breaker**: авто-размыкание при ошибках провайдера, ручной `circuit/reset`.
- **Emergency off**: `POST .../rollout/emergency-off` — мгновенное отключение.
- **Evaluation**: `POST .../rollout/evaluate` + `GET .../evaluations` — офлайн-оценка на approved aliases.

## E. Значимые изменения API

42 новых endpoint'а (полный перечень: `HUBTENDER_RC1_API.md`). Ключевые группы: `/health/recalc`, `/health/ai`, 8 аналитических GET, 3 smart-import POST, 5 import-memory, 22 admin AI (закрыты backend role-гейтом `RequireRoles(AIAdminRoles)`), 1 pilot capability. Один retired endpoint: `PATCH /api/v1/items/bulk-commercial` → 410-tombstone.

## F. Значимые изменения schema

10 новых инкрементальных миграций (`db/yandex/incremental/2026_07_*.sql`; 9 этапов 0–2.6 + 1 RC1-фикс baseline-gap) + baseline (`db/yandex/sql/03–06`), выровненный с цепочкой (schema equivalence PASS). Полный manifest и release-blocking фиксы: `HUBTENDER_RC1_MIGRATIONS.md`.

## G. Значимые frontend routes

- Страницы аналитики тендера: качество, ценовые отклонения, источники цен, план действий, изменения расчёта, отчёт для проверки (deep links с BOQ).
- Мастер Smart Import в ClientPositions (`SmartImportWizard`).
- Админ-страница OpenRouter AI (каталог, модель, rollout, пилот, квоты, бюджет, evaluations).

## H. Feature flags и безопасные defaults

| Флаг/настройка | Default | Эффект default |
|---|---|---|
| AI rollout mode (`ai_nomenclature_rollout.mode`, seed миграции) | `off` | AI-подбор недоступен всем; suggest отвечает детерминированно |
| `AI_NOMENCLATURE_ENABLED` | `false`/absent | DisabledProvider, AI-путь выключен |
| `OPENROUTER_API_KEY` | absent | Приложение стартует; admin-статус показывает «ключ не настроен»; live-вызовы невозможны |
| `RECALC_RECOVERY_ENABLED` | `true` | Recovery-скан включён по умолчанию |
| `AI_ROLLOUT_MAINTENANCE_ENABLED` | `true` | Квоты/retention-обслуживание включено |
| Пилотный список | пуст | Даже в `pilot` никто не получает AI без явного добавления |
| AI-предложение в UI | не выбрано | Требуется явное подтверждение инженера |

## I. Известные ограничения

1. Release-ветка **отстаёт от origin/main на 12 коммитов** (мобильные/UX-фиксы владельца). Требуется merge origin/main до push (см. integration plan в итоговом отчёте; 9 пересекающихся файлов, включая `backend/cmd/server/routes.go` — CORS `Cache-Control`).
2. Юнит-тестов фронта нет (Vitest/Jest не настроены) — верификация фронта: tsc, ESLint zero-warning, guard-скрипты, Playwright release smoke.
3. Покрытие handlers-слоя Go выборочное (error-path тесты); полное покрытие — через integration + E2E.
4. `npm run build` на данном host-е исторически падал по памяти на «rendering chunks» (errno 1455) — сборка выполняется с `NODE_OPTIONS=--max-old-space-size=8192`; при OOM сборку выполнять на CI/сервере.
5. AI-оценка (evaluation) работает на approved aliases; отдельного золотого датасета нет.
6. Legacy Supabase anon-ключ в `scripts/archive/*.cjs` (pre-existing, до release-диапазона; anon-ключ публичный по дизайну) — в backlog на зачистку истории/ротацию проекта.
