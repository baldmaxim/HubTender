# HUBTender RC1 — API Inventory (этапы 0–2.6)

Commit `662f50b`. Новые/изменённые endpoints release-диапазона (`952d729..662f50b`). Все маршруты, кроме `/health*`, — внутри `r.Group(authMW)` (RS256 app JWT). Ошибки — RFC 7807 ProblemDetail. Конфликтов маршрутов нет: chi падает при duplicate registration на старте, backend стартует в rehearsal/e2e — подтверждено. Admin AI-группа дополнительно закрыта **backend**-гейтом `middleware.RequireRoles(handlers.AIAdminRoles)` (`backend/cmd/server/routes.go`), не только frontend page-ACL; non-admin получает 403 (см. `ai_admin_test.go`, E2E `ai-admin.spec.ts`).

## Health / recovery / readiness (без auth — liveness; диагностика служебная)

| Method | Path | Назначение | Flag/rollout |
|---|---|---|---|
| GET | `/health/recalc` | диагностика recovery: stale-скан, reclaim-статистика | `RECALC_RECOVERY_ENABLED` (default on) |
| GET | `/health/ai` | диагностика AI-подсистемы: провайдер, circuit, rollout mode | read-only, работает при `off` |

Readiness-audit — не HTTP, а CLI `backend/cmd/production-readiness-audit` (read-only, `--json-out`).

## Аналитика (read-only, GET, auth)

| Path (`/api/v1/tenders/{id}/…`) | Назначение | Ошибки |
|---|---|---|
| `quality` | проверки качества расчёта | 404 tender |
| `price-benchmarks` | catalog-бенчмарк, Tukey-статистика | 404 |
| `price-benchmarks/{itemId}/history` | история согласованных цен позиции | 404 |
| `price-source-quality` | покрытие/актуальность quote_link | 404 |
| `action-plan` | приоритетная очередь (REPEATABLE READ снапшот) | 404 |
| `change-impact` | exact-diff версий тендера | 404, 409 (несравнимые версии) |
| `review-report` | JSON review pack | 404 |
| `review-report.xlsx` | XLSX-пакет (formula-injection-safe, fingerprint) | 404 |

Все — mutation-free (guard'ы `*Safety` подтверждают отсутствие записи в финансовые таблицы).

## Smart Import (auth, мутации только в execute)

| Method | Path | Назначение |
|---|---|---|
| POST | `/api/v1/tenders/{id}/boq-import/analyze` | серверный анализ Excel: sheet/mapping/нормализация, fingerprint. Read-only |
| POST | `/api/v1/tenders/{id}/boq-import/execute` | импорт через authoritative-путь; проверка fingerprint (409 при смене файла); **никаких provider-вызовов** (guard `aiNomenclatureSafety`) |
| POST | `/api/v1/tenders/{id}/boq-import/suggest-nomenclature` | детерминированные кандидаты + optional AI rerank; live-гейт: rollout/pilot/quota/budget/circuit; фолбэк — детерминированный |

## Import Memory (auth, персональные данные пользователя)

| Method | Path | Назначение |
|---|---|---|
| GET | `/api/v1/boq-import/mapping-profiles` | список mapping-профилей (только свои) |
| PATCH / DELETE | `/api/v1/boq-import/mapping-profiles/{id}` | переименовать / удалить |
| GET | `/api/v1/boq-import/nomenclature-aliases` | подтверждённые aliases |
| DELETE | `/api/v1/boq-import/nomenclature-aliases/{id}` | удалить alias |

## Admin AI (auth + `RequireRoles(AIAdminRoles)`)

| Method | Path (`/api/v1/admin/ai/…`) | Назначение | Mutation |
|---|---|---|---|
| GET | `openrouter/status` | статус подключения (ключ настроен/нет, без значения ключа) | нет |
| POST | `openrouter/test-connection` | тест соединения | нет (внешний вызов) |
| GET | `openrouter/models` | каталог моделей (кэш) | нет |
| POST | `openrouter/models/refresh` | обновить каталог | кэш |
| GET / PUT | `nomenclature-settings` | настройки модели (draft) | да (config) |
| POST | `nomenclature/test-model` | тест модели на образцах | нет (внешний вызов) |
| POST | `nomenclature/activate` / `deactivate` | включить/выключить AI-фичу | да (config) |
| GET | `nomenclature/rollout` | состояние rollout | нет |
| PUT | `nomenclature/rollout/settings` | квоты/бюджет/circuit-параметры (optimistic `rollout_config_version`) | да |
| POST | `nomenclature/rollout/transition` | смена режима `off↔evaluation↔pilot_*` (явный запрос, live-гейт) | да |
| POST | `nomenclature/rollout/emergency-off` | аварийное отключение (мгновенно) | да |
| GET / POST | `nomenclature/pilot-users` | список / добавить пилота | да |
| PATCH / DELETE | `nomenclature/pilot-users/{userId}` | изменить / убрать пилота | да |
| GET | `nomenclature/usage` | usage-ledger (без prompt/response/цен BOQ) | нет |
| GET | `nomenclature/evaluations` | история оценок | нет |
| POST | `nomenclature/evaluate` | запуск оценки на approved aliases | да (записи eval) |
| POST | `nomenclature/circuit/reset` | ручной сброс circuit breaker | да |

## Пользовательский AI-capability

| Method | Path | Назначение |
|---|---|---|
| GET | `/api/v1/ai/nomenclature-capability` | доступен ли AI текущему пользователю (rollout+pilot+quota); при `off` → `available:false`, UI не показывает AI |

## Retired

| Method | Path | Поведение |
|---|---|---|
| PATCH | `/api/v1/items/bulk-commercial` | 410 tombstone (`boq_bulk_retired_test.go`) — коммерческие стоимости пишет только сервер |

Смежные retired SQL RPC (`bulk_update_boq_items_commercial_costs`, `save_redistribution_results`, SQL grand-total) — fail-closed заглушки на уровне БД (см. MIGRATIONS manifest).

## Замечание о WIP владельца

Untracked `backend/cmd/server/routes_test.go` из исходного worktree в release-ветку **не включён** (файл не отслеживается git и в worktree-checkout отсутствует).
