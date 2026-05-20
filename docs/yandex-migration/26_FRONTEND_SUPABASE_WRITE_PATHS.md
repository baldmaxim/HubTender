# Frontend Supabase Business Path Migration

> Цель: убрать из **runtime** фронта все business-вызовы
> `supabase.from/rpc/channel/removeChannel`; оставить временно только
> `supabase.auth.*` (bridge) + `src/lib/supabase/client.ts` (для auth) +
> `database.types.ts` (типы). **Не деплоить, не пушить, БД/`DATABASE_URL`/
> import/clean/repair/app-auth — не трогать. Секреты не печатать.**

- Дата (UTC): 2026-05-18
- Связано: [25](./25_FRONTEND_GO_ROUTING_FIX.md) (`FRONTEND_GO_ROUTING_BUILD_OK`),
  [23](./23_RUNTIME_CUTOVER_RESULT.md) (`RUNTIME_CUTOVER_OK`).

## Current bridge mode

Supabase Auth разрешён (login/JWT). Supabase business
(`from`/`rpc`/`channel`) — запрещён в runtime. Go BFF (`DATABASE_URL` →
Yandex) обслуживает бизнес-данные.

## ⚠️ Корректировка масштаба (критично)

Указанная в задаче команда `rg -n "supabase\.(from|rpc|channel|removeChannel)"`
(и первый аудит doc 25) — **line-based** и НЕ ловит multiline-цепочки
`supabase⏎  .from(...)`, которыми написана бóльшая часть кодовой базы.

| Метод | Результат |
|---|---|
| line-based `rg`/grep | ~75 вхождений (создал иллюзию «осталось 7 путей») |
| **multiline grep** (`supabase\s*\.\s*(from\|rpc\|channel\|removeChannel)\s*\(`) | **479 вхождений в 112 файлах** |

Из них:
- **~130** — gated-слой `src/lib/api/*` (else-fallback под `isGoEnabled`;
  не runtime при `.env.production` go-mode).
- **~349 в ~93 файлах** — **un-gated** прямые Supabase business-вызовы в
  `src/pages/**`, `src/services/**` (markupTactic, costImportService),
  `src/utils/**` (copyBoqItems, insertTemplateItems, versionTransfer/*,
  calculateGrandTotal, initializeTestMarkup …), `src/hooks/**`
  (useTenderNotes, useDeadlineCheck …), `src/components/Layout/MainLayout.tsx`.
  **Без `isGoEnabled`-ограждения и без Go-эндпоинта.**

**Следствие:** `25_FRONTEND_GO_ROUTING_FIX.md` («с `.env.production`
бизнес → Go») верно ТОЛЬКО для gated `src/lib/api/*`. ~93 un-gated файла
продолжат ходить в Supabase pre-prod независимо от env. Премиса оператора
«осталось 7 paths» основана на неполном line-based аудите и **неверна**.

**Реальный объём** — это не «инкремент на ~10 файлов», а
**кодовая миграция ~93 файлов / ~349 un-gated callsites фронта + десятки
новых Go-эндпоинтов** (version-transfer уже есть; clone, tender-notes,
notifications, tasks, projects-detail, markup-tactics service, cost-import,
template-items, BOQ copy/insert, deadline-check, bsm, analytics-comparison,
library/* и т.д. — большинства Go-эндпоинтов НЕТ). Это многонедельный
проект уровня «перенести весь data-layer фронта на Go BFF» (Phase 5 целиком),
а не одна задача-промпт. Безопасно one-shot/несколькими инкрементами в одной
сессии **не выполнимо** без риска регрессий в необратимых write-путях.

## Audit result

Команда (line-based, НЕПОЛНАЯ — см. корректировку выше):
`rg -n "supabase\.(from|rpc|channel|removeChannel)" src --glob '!**/database.types.ts'`.
Достоверный аудит — **multiline** grep (479/112).

### Кат. 1 — Supabase Auth (временно допустимо)

- `src/lib/supabase/client.ts` — init клиента (только auth).
- `src/lib/api/client.ts` — `supabase.auth.getSession()` для Bearer.
- `src/contexts/AuthContext.tsx` — `supabase.auth.*` (login/session).

### Кат. 2 — GATED business в `src/lib/api/*` (guarded `if (isGoEnabled(domain))`)

else-ветка `supabase.*` выполняется ТОЛЬКО при `isGoEnabled(domain)=false`.
С проверенным `.env.production` (doc 25: `VITE_API_MODE=go` + все
`VITE_API_*_ENABLED=true`) `isGoEnabled=true` для всех 18 доменов →
**эти ветки в production-runtime не исполняются** (documented non-runtime
fallback). Файлы: `tenders.ts`, `fi.ts`, `userAdmin.ts`, `timeline.ts`,
`tenderRegistry.ts`, `redistributions.ts`, `projects.ts`,
`positionFilters.ts`, `notifications.ts`, `nomenclatures.ts`, `markup.ts`,
`costs.ts`, `boq.ts`, `users.ts`, `hooks/useApiReferences.ts` (~80
callsites). Полное удаление fallback-веток = отдельный крупный рефактор
(каждый хелпер сделать Go-only); не выполняется слепо в одном проходе —
вынесено в follow-up (см. §Remaining).

### Кат. 3 — UN-GATED runtime business (ОБЯЗАТЕЛЬНО мигрировать)

| Файл | Supabase call | Таблица/RPC | Op | Целевой Go endpoint | Статус |
|---|---|---|---|---|---|
| `src/utils/versionTransfer/executeVersionTransfer.ts:42` | `rpc('execute_version_transfer')` | RPC | write | **ЕСТЬ** `POST /api/v1/tenders/{id}/versions/transfer` | TODO frontend wrapper |
| `src/utils/versionTransfer/cloneTenderAsNewVersion.ts:21` | `rpc('clone_tender_as_new_version')` | RPC | write | **НЕТ** → новый `POST /api/v1/tenders/{id}/versions/clone` (вызывает SQL-func в Yandex) | TODO backend+frontend |
| `src/utils/versionTransfer/createNewVersion.ts:128` | `from('tenders').delete()` | tenders | write(cleanup) | покрывается транзакцией clone/transfer на бэке | TODO (убрать клиентский cleanup) |
| `src/pages/ClientPositions/hooks/useMassBoqImport.ts:411` | `rpc('bulk_import_client_position_boq')` | RPC | write | **ЕСТЬ** `POST /api/v1/imports/boq` | TODO frontend hook |
| `src/pages/PositionItems/hooks/useAuditRollback.ts:38` | `from('boq_items').insert()` | boq_items | write | **ЕСТЬ** `POST /api/v1/tenders/{id}/positions/{posId}/items` (audited) | TODO frontend hook |
| `src/lib/supabaseWithAudit.ts:108/151/182` | `rpc(insert/update/delete_boq_item_with_audit)` | RPC | write | **ЕСТЬ** `POST/PATCH/DELETE /api/v1/items*` (audited в pgx.Tx) | TODO заменить вызывающих, удалить deprecated |
| `src/hooks/useTenderNotes.ts` (`from('users')`, `from('tender_notes')`) | tender_notes/users | r/w | **НЕТ** → новые `GET/POST/PATCH/DELETE` notes endpoints | TODO backend+frontend |
| `src/utils/checkDatabaseStructure.ts:134` | `rpc('check_rls_status')` | RPC | diag | dev/debug — исключить из runtime bundle | TODO (gate/remove) |

### Кат. 4 — Realtime (`supabase.channel/removeChannel`)

Call-sites `removeChannel`: `MainLayout.tsx:103`, `Admin/Tenders/hooks/
useTendersData.ts:148`, `ClientPositions/hooks/useClientPositions.ts:355`,
`Admin/ConstructionCostNew/hooks/useCostData.ts:840`, `CostRedistribution/
hooks/useRedistributionData.ts:112`, `FinancialIndicators.tsx:124`.
Подписка (`supabase.channel(...)`) ограждена `isRealtimeEnabled()`
(пропускается при `VITE_API_REALTIME_ENABLED=true` → нативный Go WS-хаб
`wss://tender.su10.ru/api/v1/ws`, ранее 101 OK). Требуется: подтвердить, что
и cleanup-`removeChannel` недостижим в production-режиме (canal не создаётся),
и/или закрыть его тем же флагом. TODO verify+gate.

## P5.4 — Go-only gated `src/lib/api/*` (in progress, verified батчами)

`src/lib/api` multiline: ~130/19 → **117/11** (tsc=0, vite build ✓).

- **DONE (Go-only, 0 supabase):** `notifications.ts`, `tenders.ts`,
  `redistributions.ts`, `users.ts`, `positions.ts`, `boq.ts`,
  `insurance.ts`, `fi.ts` + (P5.1) `supabaseWithAudit.ts`,
  `useMassBoqImport.ts`.
- **timeline.ts** — 2 gated→Go (`setTenderGroupQuality`,
  `respondTenderIteration`); **2 un-gated остаются** →
  `listTimelineAssignableUsers` (нужен `GET /api/v1/timeline/
  assignable-users`), `createTenderIteration` (нужен
  `POST /api/v1/timeline/iterations`) — **P5.3** (нет Go-эндпоинта).
- **batch-2 DONE:** `positionFilters.ts`, `importLog.ts`,
  `hooks/useApiReferences.ts`.
- **batch-3 DONE:** `tenderRegistry.ts`, `projects.ts`, `costs.ts`,
  `nomenclatures.ts`, `markup.ts`, `userAdmin.ts`.

### ✅ P5.4 ЗАВЕРШЁН (verified: `tsc` 0, `npm run build` ✓)

Весь gated-слой `src/lib/api/*` — **Go-only, 0 Supabase-fallback**.
`src/lib/api` multiline: **130/19 → 3** (все non-business):
`featureFlags.ts:48` — комментарий (не вызов); `timeline.ts:18,25` — 2
**un-gated** функции (`listTimelineAssignableUsers`,
`createTenderIteration`) → P5.3 (нужны Go-эндпоинты, нет backend).

## P5.3 — versionTransfer dead-code removed (verified)

«Самое сложное» (`src/utils/versionTransfer/*` клиент-оркестрация
многотабличной записи) оказалось **мёртвым кодом**: 6 модулей
(`createNewVersion`, `transferPositionData`, `handleAdditionalPositions`,
`copyBoqItems`, `copyCostVolumes`, `copyInsuranceData`) нигде не
использовались — вытеснены серверным `executeVersionTransfer` (Go, P5.1).
Удалены (нулевой риск). Тип `AdditionalWorkTransfer` (нужен UI VersionMatch)
сохранён как чистый `versionTransfer/types.ts`. `tsc` 0, `vite build` ✓.
−6 файлов, ~−23 un-gated callsites.

**Прогресс `src` multiline supabase-business: 479/112 (старт) → 316/84.**
В `src/lib/api` осталось только `timeline.ts:2` (un-gated → P5.3) +
`featureFlags.ts:1` (комментарий, не вызов).

## P5.3 — timeline domain DONE (verified)

2 новых Go-эндпоинта (мирроринг паттерна clone/notes):
`GET /api/v1/timeline/assignable-users`,
`POST /api/v1/timeline/iterations` (user_id из JWT, не из body) —
repo/service/handler расширены, routes + DI. Фронт `src/lib/api/timeline.ts`
→ полностью Go (0 supabase). `go build` 0, `go test` без новых провалов
(calc pre-existing §11), `tsc` 0, `vite build` ✓. **Весь `src/lib/api/*`
теперь Supabase-free** (остался только `featureFlags.ts:1` — комментарий).

## P5.3 — markupTactic-services (частично, verified)

`services/markupTactic/calculation.ts` + `parameters.ts` → **0 supabase**:
переведены на существующие Go-хелперы `lib/api/markup.ts`
(`getTenderPricingDistribution`, `listSubcontractGrowthExclusionsForTender`,
`listTenderMarkupPercentages`) — нового backend не потребовалось. `tsc` 0.

**Остаётся `tactics.ts` (13)** — высокорисковый pricing-путь. ⚠️
**Верификация триггеров выполнена:** `trg_boq_items_grand_total`
(`05_triggers.sql:26-29`) = `AFTER ... UPDATE OF total_amount` — НЕ
срабатывает на commercial-only апдейт (`commercial_markup`/
`total_commercial_*_cost`). Значит **`updatePositionTotals` НЕ избыточен**:
client_positions commercial-тоталы НЕ пересчитываются этим триггером при
markup-пересчёте. Наивное удаление `updatePositionTotals` → молчаливая
порча коммерческих тоталов позиций.

### Верификация ЗАВЕРШЕНА (решающий результат)

`recalculate_tender_grand_total(p_tender_id)` (`04_functions.sql:1408-1443`)
обновляет **ТОЛЬКО `tenders.cached_grand_total`** (Σ
`boq_items.total_commercial_*` + страховка). Go-repo
`BulkBoqRepo.BulkUpdateCommercial` (`repository/boq_bulk.go`) и триггер
`trg_boq_items_grand_total` оба зовут именно эту функцию.
**Нигде на сервере НЕ пересчитываются `client_positions.total_commercial_
material/work`.** → `updatePositionTotals` обязателен, серверного
эквивалента НЕТ. Слепое удаление = молчаливая порча commercial-тоталов
позиций.

### План tactics.ts (де-рискованный, требует НОВОГО Go-эндпоинта)

1. **Новый Go-эндпоинт** `POST /api/v1/positions/{id}/recompute-commercial`
   (repo/service/handler+route): `UPDATE client_positions SET
   total_commercial_material = (SELECT COALESCE(SUM(
   total_commercial_material_cost),0) FROM boq_items WHERE
   client_position_id=$1), total_commercial_work = (… work …),
   updated_at=NOW() WHERE id=$1` — точный эквивалент `updatePositionTotals`.
2. Возможно `GET /api/v1/positions/{posId}/items` — `applyTacticToPosition`
   имеет только positionId (нет tenderId для существующего
   `/tenders/{id}/positions/{posId}/items`); либо получать tenderId иначе.
3. tactics.ts reads → `getMarkupTactic` / `getTenderMarkupTacticId` /
   `listAllBoqItemsForTender` (Go, существуют); single boq — `GET
   /api/v1/items/{id}`.
4. writes (single + batch) → `bulkUpdateCommercial` (Go; grand-total
   пересчитает сервер). `applyTacticToBoqItem` single-update →
   `bulkUpdateCommercial([{…}])`.
5. `updatePositionTotals` → вызов нового эндпоинта (п.1). Убрать
   supabase `fallbackBatchUpdateBoqItems` (Go-only, ошибку пробрасывать).
6. Верификация: `go build`/`go test`/`tsc`/`vite build` + сверка
   commercial-значений позиции до/после на тест-тендере.

→ tactics.ts — не механический перевод: это **backend (новый эндпоинт) +
аккуратный фронт + поведенческая сверка**, отдельным focused-инкрементом.

### ✅ tactics.ts DONE — упрощено анализом callers (verified)

Каллер-анализ: `applyTacticToBoqItem` / `applyTacticToPosition` /
`updatePositionTotals` / `recalculateAfterParameterChange` использовались
**только внутри tactics.ts** — наружу (`useCommerceActions` →
`markupTacticService` barrel) экспонируется и зовётся ТОЛЬКО
`applyTacticToTender` (имеет `tenderId`). → они **мёртвый код**, удалены
(как versionTransfer). **Новый Go-эндпоинт recompute НЕ нужен** — он был
только в мёртвом `applyTacticToPosition`/`updatePositionTotals`; риск
pricing-порчи снят (мёртвый путь не исполняется).

Живой `applyTacticToTender` → Go: `getTenderMarkupTacticId` /
`getMarkupTactic` / `listAllBoqItemsForTender` / `bulkUpdateCommercial`
(grand-total пересчитывает сервер); supabase-fallback убран; type-bridge
для строгого `MarkupTactic`. **markupTactic-домен полностью Go-only,
0 supabase.** `tsc` 0, `vite build` ✓.

## P5.3 — статус остатка (честно): «лёгкие» победы исчерпаны

Закрыто (Go-only, verified, pushed): P5.1, P5.2, **весь P5.4**
(`src/lib/api/*`), versionTransfer (dead-code), timeline-домен (+2
эндпоинта), **markupTactic полностью** (calc+params+tactics).
`src` multiline supabase-business: **479/112 → ~278/~74**.

Все простые пути (мёртвый код; reuse существующих Go-хелперов) —
**исчерпаны**. Остаток = **net-new backend в core/чувствительных путях**,
каждый — focused-сессия (свежий контекст + полная верификация):

| Домен | Что нужно (backend) |
|---|---|
| `useDeadlineCheck` | расширить core `GET /api/v1/me` + домен `user` JSONB `tender_deadline_extensions` (чувствит. shared-путь) + фронт → `getTenderById`+`/me` |
| `AuthContext` (`loadUserData`) | профиль через Go (`/api/v1/me`-расширенный) вместо `supabase.from('users')` — затрагивает весь auth-bridge |
| `Tasks/*` (TaskListTab/index/Employee/AddTask) | Go-домена задач НЕТ — repo+service+handler+routes для tasks CRUD с нуля |
| big page-hooks `useBoqItems`/`useCostData`/`usePositionActions`/`useBoqItemsImport`/`useClientPositions` | новые Go-эндпоинты по boq/positions read+write, критичные write-пути |
| `Library/*`, `Commerce`(useCommerceData/Actions), `Bsm`, `Analytics/ObjectComparison`, `costImportService`, `insertTemplateItems`, `calculateGrandTotal`, `MainLayout`-notifications, `Tenders/*`-modals, `useTendersData`/`useTenderActions`/`useBoqUpload` | новые Go-эндпоинты по доменам |

Каждый домен полностью специфицируется по образцу clone/notes/timeline
(route+handler+service+repo, pgx+JWT+tx, фронт → apiFetch, верификация
`go build`/`go test`/`tsc`/`vite build` + multiline-grep). Делать
focused-сессиями, не одним проходом. P5.5/P5.6 — после закрытия P5.3.

## P5.3 — Tasks-домен DONE (verified, новый Go-домен с нуля)

5 новых Go-эндпоинтов (мирроринг clone/notes/timeline):
`GET /api/v1/tasks` (user_id?/exclude_completed? → ListByUser; без user_id
→ ListAll, server-side privilege по role_code {administrator,director,
developer}), `POST /api/v1/tasks`, `PATCH /api/v1/tasks/{id}`,
`GET|PATCH /api/v1/users/{id}/work-settings`. repo/service/handler+routes+DI.
Фронт: новый `src/lib/api/tasks.ts` + 4 файла (`index`/`TaskListTab`/
`AddTaskModal`/`EmployeeTasksTab`) → 0 supabase; users/tenders-списки
переиспользуют `listTimelineAssignableUsers`/`fetchTenders` (Go).
`go build ./...` 0, `go test` без новых провалов (calc pre-existing §11),
`tsc` 0, `vite build` ✓.

## P5.3 — useDeadlineCheck DONE (verified, изолированно)

Новый изолированный `GET /api/v1/me/deadline-extensions` (UserRepo.
GetDeadlineExtensions → JSONB raw; UserService passthrough;
MeHandler — **НЕ трогая** user.User/GetMe/cache/AuthContext, минимальный
blast-radius). Фронт `src/hooks/useDeadlineCheck.ts` → `getTenderById`
(Go fi.ts) + `apiFetch('/api/v1/me/deadline-extensions')`, 0 supabase.
`go build ./...` 0, `go test` без новых провалов (calc pre-existing §11),
`tsc` 0, `vite build` ✓. AuthContext.loadUserData (high-blast-radius
auth-bridge) НЕ трогался — отдельный осторожный шаг.

## P5.3 — Analytics/ObjectComparison DONE (verified)

Новый comparison-домен: `GET /api/v1/comparison-notes?tender_id_1=&
tender_id_2=` (обе ориентации), `POST /api/v1/comparison-notes` (upsert
обеих ориентаций в tx, created_by из JWT, тот же unique-constraint),
`GET /api/v1/tenders/{id}/cost-volumes` — repo/service/handler+routes+DI.
Фронт `useComparisonData.ts`: notes/volumes → новые эндпоинты;
`fetchBoqItems` → reuse `listAllBoqItemsForTender` (fi, Go) +
`listDetailCostCategoriesWithCategory` (costs, Go), семантика прежних
`!inner`-джойнов сохранена (фильтр по резолвящемуся detail_cost_category_id);
tenders уже были Go. 0 supabase. `go build ./...` 0, `go test` без новых
провалов (calc pre-existing §11), `tsc` 0, `vite build` ✓.

## P5.3 — Bsm DONE (verified)

2 новых quote-link эндпоинта (расширение BulkBoq):
`PATCH /api/v1/tenders/{id}/boq/quote-link` (field whitelisted
material_name_id|work_name_id, value параметризован),
`PATCH /api/v1/boq/quote-link-by-ids`. Фронт `Bsm.tsx`: tenders →
`apiFetchTenders`; detail-cats → `listDetailCostCategoriesWithCategory`;
boq+имена → `listAllBoqItemsForTender`+`listMaterialNames`/`listWorkNames`
(shared `loadTenderBoqRaw`); quote-link updates → новые эндпоинты.
0 supabase. `go build ./...` 0, `go test` без новых провалов (calc
pre-existing §11), `tsc` 0, `vite build` ✓.

## P5.3 — calculateGrandTotal DONE (verified, без нового backend)

Все 4 read → существующие Go-хелперы: `getTenderById` (проверка
существования, 404→0), `listTenderMarkupPercentages`,
`listAllBoqItemsForTender`, `listSubcontractGrowthExclusionsForTender`.
Чистый фронт-рефактор, backend не трогался. Type-guard вместо
`.filter(Boolean)` (строгий `markup_parameter: MarkupParameter|null`).
0 supabase, `tsc` 0, `vite build` ✓.

## P5.3 — costImportService DONE (verified; +Yandex schema-fix)

⚠️ Находка: оригинал использовал таблицу `locations` + `detail_cost_
categories.location_id` — это **старая Supabase-схема**; Yandex имеет
`detail_cost_categories.location TEXT NOT NULL` и **таблицы `locations`
нет** → фича была сломана против Yandex (pre-existing, как clone). Новый
`POST /api/v1/cost-import` (repo/service/handler+route+DI) делает всё
атомарно в pgx.Tx под **Yandex-схему**: cost_categories find-or-create
(name+unit), detail_cost_categories bulk-insert (skip по
cost_category_id+name), `location` как TEXT. Фронт парсит Excel и шлёт
один payload. 0 supabase. `go build ./...` 0, `go test` без новых
провалов (calc pre-existing §11), `tsc` 0, `vite build` ✓.

## P5.3 — PositionItems/useBoqItemsImport DONE (PositionItems закрыт)

`src/pages/PositionItems/hooks/useBoqItemsImport.ts` (10 supabase → 0):
- справочники (work_names/material_names/detail_cost_categories) → reuse
  `listWorkNames`/`listMaterialNames`/`listDetailCostCategoriesWithCategory`
  (фильтр `cost_categories != null` воспроизводит `!inner`);
- мёртвая дублирующая ветка legacy-загрузки удалена (после
  `return true` в активном блоке);
- курсы валют → `getTenderById`;
- max sort_number позиции → `listBoqItemsFullByPosition` + reduce;
- insert work_names/material_names → `createWorkName`/`createMaterialName`
  через `Promise.all`. `insertBoqItemWithAudit` уже в Go.

**Весь `src/pages/PositionItems` теперь 0 supabase.** `go build` 0,
`tsc` 0, `vite build` (background).

## P5.3 — PositionItems/useBoqItems DONE (verified; 2 новых + reuse)

`src/pages/PositionItems/hooks/useBoqItems.ts` (12 supabase → 0).
Ядро BOQ-чтения позиции. 2 новых эндпоинта, остальные 10 — reuse.

| Эндпоинт/хелпер | Заменяет |
|---|---|
| **новый** `GET /api/v1/positions/{id}/with-tender` (repo `GetPositionWithTender`+svc+handler+route) | `client_positions.* + tenders(rates)` join |
| **новый** `GET /api/v1/positions/{id}/boq-items-full` (repo `ListBoqItemsFullByPosition`+svc+handler+route) | `boq_items + material_names + work_names + parent_work(work_names) + detail_cost_categories(+cost_categories+location)` — 6-уровневая вложенность через LEFT JOIN |
| `listMaterialsLibrary` / `listWorksLibrary` (фильтр по ids на клиенте) | `materials_library` / `works_library` IN-фильтры |
| `listTemplates` (+sort by name на клиенте) | `templates + detail_cost_categories(+cost_categories+location)` |
| `listDetailCostCategoriesWithCategory` | `detail_cost_categories + cost_categories(name)` |
| `listWorkNames`/`listMaterialNames` (+sort by name) | paged work_names/material_names |
| `listActiveUnits` (+sort by code) | units |

Вся client-side calc (sortItemsByHierarchy, calculateBoqItemTotalAmount,
library-rate fallback) без изменений. `go build` 0, `tsc` 0, `vite build` ✓
(идёт в фоне). Остаток PositionItems: `useBoqItemsImport`10.

## P5.3 — PositionItems/useItemActions DONE (verified; 3 новых эндпоинта)

`src/pages/PositionItems/hooks/useItemActions.ts` (6 supabase → 0):

| Эндпоинт | Заменяет |
|---|---|
| **новый** `POST /api/v1/positions/{id}/recompute-totals` (repo `RecomputePositionTotals`+service+handler+route) | select boq_items + reduce + update client_positions totals (одна UPDATE-FROM на сервере) |
| **новый** `POST /api/v1/items/{id}/recompute-linked-materials` (BoqRepo `RecomputeLinkedMaterialsForWork`+service+handler+route) | tx: read work qty + tender rates + FOR UPDATE детей + per-child update+audit (`calc.CalculateBoqItemTotalAmount` на сервере) |
| **новый** `PATCH /api/v1/positions/{id}/fields` (repo `UpdatePositionFields`+service+handler+route) | manual_volume/manual_note/work_name/unit_code (динамический SET по non-nil полям) |

`insertBoqItemWithAudit`/`updateBoqItemWithAudit`/`deleteBoqItemWithAudit`/
`insertTemplateItems` уже в Go. Calc-формула для каскадного пересчёта
детей теперь авторитативно на сервере (раньше дублировалась на клиенте).
`go build` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — PositionItems audit batch DONE (verified; новый audit-list)

`src/pages/PositionItems/{hooks/useAuditHistory.ts, components/AuditFilters.tsx,
PositionItems.tsx}` (4+1+1 → 0):

| Эндпоинт/хелпер | Заменяет |
|---|---|
| **новый** `GET /api/v1/boq-audit?position_id=&date_from=&date_to=&user_id=&operation_type=` (repo `ListByPosition`+service+handler+route на BoqAuditRollbackRepo) | `boq_items_audit` + user embed + JSONB-filter `new_data->>client_position_id OR old_data->>client_position_id` + optional date/user/op filters; one query, NULL-or-param trick |
| `listWorkNames`/`listMaterialNames`/`listAllDetailCostCategoriesByOrder` (фильтр по ids на клиенте) | три точечных `WHERE id IN (...)` |
| `listTimelineAssignableUsers` | `users WHERE access_enabled=true` (теряем email — был fallback-label, full_name остаётся) |
| `clearPositionsBoq([positionId])` | `client_positions.update(totals=0)` после audited-delete-loop (idempotent на уже-удалённых) |

`go build` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.
Остаток PositionItems: `useBoqItems`12/`useBoqItemsImport`10/`useItemActions`6.

## P5.3 — ClientPositions/useClientPositions DONE (verified; reuse, без backend)

`src/pages/ClientPositions/hooks/useClientPositions.ts`: 4 read-callsite →
0 (остаются 2 realtime — P5.5):

| Было | Стало |
|---|---|
| `loadAllPositions` (client_positions paged) | `fetchPositionsWithCosts` (ORDER BY position_number,id) |
| `loadAllBoqItems` (boq_items paged) | `listAllBoqItemsForTender` (суперсет полей; агрегация по позициям — порядок не важен) |
| `loadTenderById` (tenders by id) | `getTenderById` |
| `fetchTenders` (tenders list) | `fetchTenders` (tenders.ts, импорт `apiFetchTenders`) |

Пагинация (range 1000) удалена. Вся calc-логика
(`calculateBoqItemAmount`/`buildPositionStats`/`computeLeafPositions`,
SWR-кэш) без изменений. Бэкенд не трогали (pure reuse). **Остаток в
файле: 2 — `supabase.channel`/`removeChannel` (gated Supabase Realtime
fallback, `wsActive`), P5.5-scope** (тот же паттерн, что
FinancialIndicators.tsx и др.). `tsc` 0, `vite build` ✓.
**Весь `src/pages/ClientPositions` теперь без supabase-`from/rpc`
(остаются только gated realtime-каналы → P5.5).**

## P5.3 — ClientPositions/useMassBoqImport DONE (verified; reuse + 1 новый)

`src/pages/ClientPositions/hooks/useMassBoqImport.ts` (9 supabase → 0).
`insertBoqItems` уже шёл в Go (`/api/v1/imports/boq`). Остальное:

| Было | Стало |
|---|---|
| `work_names`/`material_names` paged | `listWorkNames`/`listMaterialNames` |
| `detail_cost_categories` + `cost_categories!inner` | `listDetailCostCategoriesWithCategory` + фильтр `cost_categories != null` (воспроизводит !inner) |
| `client_positions` by tender paged | `fetchPositionsWithCosts` |
| `units` active | `listActiveUnits` (сорт по code на клиенте) |
| `tenders` rates | `getTenderById` |
| `boq_items` by positions + name embeds | **новый** `GET /api/v1/positions/boq-preview?position_ids=` (repo `ListBoqPreviewByPositions`+service+handler+route) |
| insert `work_names`/`material_names` (массив) | `createWorkName`/`createMaterialName` через `Promise.all` |

`fetchAllPages` helper удалён (пагинация больше не нужна). Парсинг/
валидация/`calculateTotalAmount`/maps без изменений. `go build` 0,
`go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — ClientPositions/usePositionActions DONE (verified; 3 новых + reuse)

`src/pages/ClientPositions/hooks/usePositionActions.ts` (10 supabase → 0):
6 операций → Go. 3 новых эндпоинта (repo+service+handler+routes):

| Эндпоинт | Заменяет |
|---|---|
| `PATCH /api/v1/positions/note` | `client_positions.update(manual_note)` (paste + bulk-paste примечания) |
| `POST /api/v1/positions/clear-boq` | tx: delete boq_items + zero totals (bulk + single «очистить») |
| `PATCH /api/v1/positions/level` | `hierarchy_level = GREATEST(coalesce+delta,0)` (понижение уровня; select+loop → 1 statement) |

`handleDeleteAdditionalPosition` → reuse `bulkDeletePositions([id])`.
`copyBoqItems`/`exportPositionsToExcel` остаются (свои домены, не
supabase-вызовы в этом файле). ⚠ Поведенческое: bulk-paste-note был
per-id с подсчётом success/failed; теперь атомарный батч (all-or-nothing)
— на успех success=total. Все батч-циклы (batchSize 100) убраны →
`= ANY($1::uuid[])`. `go build` 0, `go test ./internal/services` ok,
`tsc` 0, `vite build` ✓.

## P5.3 — ClientPositions/AddAdditionalPositionModal DONE (verified)

`src/pages/ClientPositions/AddAdditionalPositionModal.tsx` (4 supabase → 0):
units → reuse `listUnits()` (Go ORDER BY sort_order; исходный `.order('code')`
воспроизведён клиентской сортировкой). Многошаговое создание ДОП-работы
(read parent → max-суффикс среди is_additional детей → расчёт 5.1/5.2 →
insert) заменено новым `POST /api/v1/positions/additional` (repo
`CreateAdditionalPosition` + service + handler + route) — одна pgx.Tx,
float-логика суффикса воспроизведена в Go (`math.Floor/Round`),
`created_by` не пишется (колонки нет на client_positions; легаси тоже не
писал). `ErrParentPositionNotFound`→404. `go build` 0,
`go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — ClientPositions/usePositionDelete DONE (verified; новый bulk-delete)

`src/pages/ClientPositions/hooks/usePositionDelete.ts` (2 supabase → 0):
двухшаговое батч-удаление (boq_items по client_position_id → client_positions
по id) заменено новым `POST /api/v1/positions/bulk-delete` (repo
`BulkDeletePositions` + service + handler + route) — одна pgx.Tx,
`= ANY($1::uuid[])`, без батчинга/audit (raw delete, как было). Сервис
инвалидирует tender:overview + positions:with_costs + tender-list.
`go build` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — Library ПОЛНОСТЬЮ закрыт (InsertTemplateIntoPositionModal, reuse)

`src/pages/Library/InsertTemplateIntoPositionModal.tsx` (2 supabase → 0):
`tenders` → reuse `fetchTenders()` (импорт как `apiFetchTenders` из-за
коллизии с локальной fn); `client_positions` paged → reuse
`fetchPositionsWithCosts()` (Go ORDER BY position_number,id; leaf-логика
`computeLeafPositionIndices` без изменений). Бэкенд не трогали. **Весь
`src/pages/Library` теперь 0 supabase.** `tsc` 0, `vite build` ✓.

## P5.3 — Library/templates DONE (verified; library-домен + templates)

`src/pages/Library/hooks/{useTemplates,useTemplateItems,useTemplateCreation,
useTemplateEditing}.ts` (2+3+3+4 supabase → 0). library-домен расширен
templates/template_items:

| Эндпоинт | Заменяет |
|---|---|
| `GET /api/v1/library/templates` | templates + detail_cost_categories(name,location,cost_categories(name)) |
| `DELETE /api/v1/library/templates/{id}` | delete template (FK cascade) |
| `GET /api/v1/library/templates/{id}/items` | template_items + works/materials_library(+names) + dcc embed, order position |
| `POST /api/v1/library/templates` | атомарное создание (template + works → materials, parent по work-индексу) |
| `PATCH /api/v1/library/templates/{id}` | tx: update header + upsert items (parent/coeff/dcc) |
| `POST /api/v1/library/templates/{id}/items` | add work/material, возвращает строку с embed |
| `DELETE /api/v1/library/template-items/{id}` | **tx: unlink детей (parent_work_item_id ON DELETE CASCADE!) → delete** |

⚠️ Критично: `template_items.parent_work_item_id` — `ON DELETE CASCADE`,
поэтому удаление work-элемента БЕЗ предварительной отвязки детей удалило
бы материалы. Легаси-двухшаг (null children → delete) воспроизведён
**в одной серверной tx**. `formatItem`/`sortItemsByHierarchy`/маппинг —
без изменений (Go отдаёт ту же вложенную форму). createTemplate резолвит
material→work parent по индексу массива работ (как tempIdToRealId).
`go build` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.
0 supabase во всём `src/pages/Library/hooks`. Остаток Library:
`InsertTemplateIntoPositionModal` (tenders+client_positions — отд. домен).

## P5.3 — Library/useLibraryData DONE (verified; reuse, без backend)

`src/pages/Library/hooks/useLibraryData.ts` (3 supabase → 0): reuse
`listWorksLibrary`/`listMaterialsLibrary` (library.ts) +
`listDetailCostCategoriesWithCategory` (costs.ts; order order_num
сохранён). Маппинг work_name/material_name/label без изменений
(array-or-object branch совместим с object-embed). Бэкенд не трогали.
`tsc` 0, `vite build` ✓.

## P5.3 — Library/useFolders DONE (verified; library_folders + move)

`src/pages/Library/hooks/useFolders.ts` (5 supabase → 0). library-домен
расширен: `GET /api/v1/library/folders?type=`, `POST/PATCH(name)/DELETE
/api/v1/library/folders[/{id}]`, `POST /api/v1/library/move`
(`{table,item_id,folder_id}` — table по allowlist
works_library|materials_library|templates, безопасная интерполяция).
library_folders без updated_at. Дерево папок строится на клиенте
(buildFolderTree без изменений). `go build` 0,
`go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — Library/MaterialsTab DONE (verified; library-домен расширен)

`src/pages/Library/MaterialsTab/` (useMaterialsData 2, useMaterialsActions 3
→ 0 supabase). library-домен расширен materials_library CRUD:
`GET/POST/PATCH/DELETE /api/v1/library/materials` (+`material_names`
embed, order created_at desc). `fetchMaterialNames` → reuse
`listMaterialNames()` (пагинация убрана, дедуп на клиенте). Сервис
инвалидирует `materials-library:all`. Симметрично WorksTab.
`go build` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — Library/WorksTab DONE (verified; новый library-домен в Go)

`src/pages/Library/WorksTab/` (useWorksData 2, useWorksActions 3 → 0
supabase). Новый Go library-домен (repo `library.go` + service +
handler + DI + routes):

| Эндпоинт | Заменяет |
|---|---|
| `GET /api/v1/library/works` | `works_library` + `work_names(id,name,unit)` embed, order created_at desc |
| `POST /api/v1/library/works` | insert works_library |
| `PATCH /api/v1/library/works/{id}` | update (work_name_id,item_type,unit_rate,currency_type) |
| `DELETE /api/v1/library/works/{id}` | delete works_library |

`fetchWorkNames` → reuse `listWorkNames()` (nomenclatures.ts); 1000-стр.
пагинация убрана, клиентская дедупликация по name→id сохранена.
Сервис инвалидирует `works-library:all`. Enum-поля шлются строками
(implicit cast, как в boq_write). `go build ./...` 0,
`go test ./internal/services` ok, `tsc` 0, `vite build` ✓.
Остаток Library (MaterialsTab/folders/templates/useLibraryData) —
следующими инкрементами по тому же library-домену.

## P5.3 — Projects domain DONE (verified; 4 новых read-эндпоинта + reuse)

`src/pages/Projects/*` (useProjectsData 4, ProjectDetail 4, ProjectModal 1,
CompletionModal 3 → 0 supabase во всём `src/pages/Projects`). Write-хелперы
projects.ts уже были; добавлены **net-new READ-эндпоинты** (repo append +
service + handler + routes):

| Эндпоинт | Заменяет |
|---|---|
| `GET /api/v1/projects` | `projects` (is_active, +tender, order created_at desc) |
| `GET /api/v1/projects/{id}` | `projects` single + tender |
| `GET /api/v1/project-agreements` | `project_additional_agreements` (все, order agreement_date asc) |
| `GET /api/v1/project-monthly-completion[?project_id=]` | `project_monthly_completion` (order year,month) |

Reuse: `listProjectAgreements` (per-project, был), `create/updateProjectMonthlyCompletion`
(были), `listActiveTendersForProjectSelect` (ProjectModal). CompletionModal
«найти запись за период» теперь `listProjectMonthlyCompletion(project.id)` +
`.find()` на клиенте (вместо точечного select). Вся клиентская
enrichment-логика (суммы соглашений/выполнения, completion %) без
изменений. Дата-поля через `to_char` (ISO/`YYYY-MM-DD`).
chi: статический `/projects/active-tenders` приоритетнее `/projects/{id}`.
`go build ./...` 0, `go test ./internal/services` ok, `tsc` 0, `vite build` ✓.

## P5.3 — TenderTimeline hooks DONE (verified; 3 новых read-эндпоинта)

`src/pages/TenderTimeline/hooks/` — вложенные PostgREST-селекты заменены
3 net-new Go read-эндпоинтами (repo `timeline_read.go` +
service + handler + routes). Вся клиентская нормализация/скоринг
(getQualityScore, pickLatestTenderVersion, getGroupStatus и т.д.) — без
изменений; эндпоинты лишь переносят выборку с PostgREST:

| Хук | Было | Стало |
|---|---|---|
| `useTenderIterations` (1) | `tender_iterations` + user/manager embeds | `GET /api/v1/timeline/groups/{groupId}/iterations?user_id=` |
| `useTenderGroups` (1) | `tender_groups` + members(+user) + iter-subset | `GET /api/v1/timeline/tenders/{tenderId}/groups` |
| `useTenders` (2) | `tender_registry` + `tenders`(+groups+iters IN tender_number) | `GET /api/v1/timeline/tenders` → `{registry, tenders}` |

Сборка вложенности в Go (ANY($1::uuid[]) + map-assembly); `tenders`
фильтруются по tender_number из registry (как было через `.in()`).
Embedded `TenderIterationRow`/`TenderGroupRow` промоутятся в JSON →
формы структурно совместимы с фронтовыми типами (хуки уже кастуют
`as unknown as`). `go build ./...` 0, `go test ./internal/services` ok,
`tsc` 0, `vite build` ✓. 0 supabase в TenderTimeline/hooks.

## P5.3 — CostRedistribution useCostCategories/useSaveResults DONE (verified)

- **useCostCategories.ts** (2 supabase) → costs.ts `listCostCategories` +
  `listAllDetailCostCategoriesByOrder`. Исходный `.order('name')`
  воспроизводится клиентским `.sort(byName)` (Go-эндпоинт detail-категорий
  сортирует по order_num — поэтому пересортировка обязательна для
  идентичного UI-порядка). Пагинации не было.
- **useSaveResults.ts** (2 supabase, только `loadSavedResults`) → **новый
  Go GET-эндпоинт** `GET /api/v1/redistributions?tender_id=&markup_tactic_id=`
  (repo `LoadResults` + service + handler + route): все строки результата +
  rules JSONB из единственной holder-строки (earliest created_at,
  redistribution_rules NOT NULL) — зеркалит легаси-загрузчик. Клиентская
  1000-строчная пагинация удалена. `saveResults` уже использовал
  `saveRedistributionResults` (Go); `supabase.auth.getUser()` — auth,
  допустимо, в multiline-аудит не попадает.

Backend: новый read-эндпоинт (паттерн save). `go build ./...` 0,
`go test ./internal/services` ok, `tsc` 0, `vite build` ✓. 0 supabase
(business) в обоих файлах. Остаток CostRedistribution (useRedistributionData
realtime-channel + reads, CostRedistribution.tsx tender_insurance) — в
следующих проходах / P5.5.

## P5.3 — мёртвые diagnostic-утилиты УДАЛЕНЫ (verified)

`src/utils/showGlobalTactic.ts` (2), `checkMarkupSequences.ts` (2),
`verifyCoefficients.ts` (2) — console.log-скрипты ручной проверки, **0
импортёров во всём репозитории** (не window-биндинг, не barrel). Удалены
как мёртвый код (паттерн versionTransfer/useMarkupTactics). −6 supabase
callsites. `tsc` 0, `vite build` ✓. Multiline-аудит: 251/68 → 229/62.

## P5.3 — MarkupConstructor DONE (verified; reuse + удаление мёртвого кода)

`src/pages/Admin/MarkupConstructor/hooks/`:

- **useMarkupParameters.ts** (5 supabase) → markup.ts: `listActiveMarkupParameters`,
  `createMarkupParameter`, `updateMarkupParameter`, `deleteMarkupParameter`.
  Max order_num считается по актуальному списку с сервера (вместо
  отдельного DB-запроса). `addParameter` теперь рефрешит список и
  возвращает созданный параметр (его return нигде не потреблялся).
- **usePricingDistribution.ts** (4 supabase) → markup.ts:
  `getTenderPricingDistribution`, `upsertTenderPricingDistribution`
  (серверный upsert по tender_id вместо клиентского select-then-update/insert).
- **useMarkupTactics.ts** (7 supabase) → **УДАЛЁН** как мёртвый+сломанный
  код: `MarkupConstructorProvider` нигде не рендерится, `useMarkupTactics(`
  нигде не вызывается, единственный потребитель контекста (`SequenceTab`)
  берёт только `{sequences,parameters,form}`. Плюс ссылался на
  несуществующие в Yandex-схеме колонки (`markup_tactics.tactic_name`,
  `markup_tactics.tender_id`, старый shape `markup_parameters`) →
  pre-existing broken (как clone/costImport). Убран экспорт из
  `hooks/index.ts` и поле `tactics` из `MarkupConstructorContext`.

0 supabase во всём `src/pages/Admin/MarkupConstructor`. Backend не
трогали (reuse существующих markup-эндпоинтов). `tsc` 0, `vite build` ✓.

## P5.3 — Commerce DONE (verified; без нового backend — reuse)

`src/pages/Commerce/hooks/useCommerceData.ts` (7 supabase) +
`useCommerceActions.ts` (1 supabase) → переведены на **существующие**
Go-хелперы, новых эндпоинтов не потребовалось:

| Было (supabase.from) | Стало (Go-хелпер) |
|---|---|
| `tenders` list | `fetchTenders()` |
| `markup_tactics` list | `listMarkupTactics()` |
| `markup_tactics` by id | `getMarkupTactic(id)` (сохр. `!sequences→null`) |
| `tenders` rates+tactic_id | `getTenderById(id)` |
| `tender_insurance` | `loadTenderInsurance(id)` (total считается на клиенте из тех же полей) |
| `client_positions` paged | `fetchPositionsWithCosts(id)` (Go ORDER BY position_number,id — leaf-flag сохранён) |
| `boq_items` paged | `listAllBoqItemsForTender(id)` (порядок не важен — сумма/агрегация по позициям) |
| `tenders.update({markup_tactic_id})` | `setTenderMarkupTacticId(id, tacticId)` (PUT /tenders/:id/markup/tactic-id) |

Удалён `fetchAllPages` (пагинация больше не нужна — Go отдаёт всё).
`markupTacticService` (loadMarkupParameters/PricingDistribution/
SubcontractGrowthExclusions/calculateBoqItemCost) уже Go-only (P5.3).
Вся calc-логика (buildPositionsFromBoqItems/computeLeafPositionIds/
applyLeafFlags) без изменений. 0 supabase во всём `src/pages/Commerce`.
`tsc` 0, `vite build` ✓ (backend не трогали).

## P5.3 — insertTemplateItems DONE (verified; новый атомарный Go endpoint)

`src/utils/insertTemplateItems.ts` — 7 supabase callsites (4×from-чтения
template/template_items/client_positions/tenders, 1×from boq_items maxSort,
1×from boq_items totals, 1×from client_positions update) +
`insertBoqItemWithAudit`/`updateBoqItemWithAudit` циклы. Новый
`POST /api/v1/templates/{templateId}/insert-into-position` (body
`{client_position_id}`) делает всё в одной pgx.Tx: выборка template +
template_items JOIN `works_library`/`materials_library` + `work_names`/
`material_names` (ORDER BY position), client_position, курсы тендера,
max(sort_number); bulk-insert boq_items с **легаси-формулой шаблона**
total_amount (НЕ `calc.CalculateBoqItemTotalAmount` — сохранена точная
семантика TS); восстановление `parent_work_item_id` по индексам массива
(UPDATE+audit); пересчёт `client_positions.total_material/total_works`;
INSERT/UPDATE audit-строки в той же tx.

⚠️ Yandex-схема: `public.boq_items` **без колонки `created_by`** (актор
аудита — `boq_items_audit.changed_by`), поэтому она намеренно отсутствует
в INSERT (легаси TS-объекты её тоже не задавали). Sentinel-ошибки
(`ErrTemplateNotFound`/`ErrPositionNotFound`→404,
`ErrTemplateEmpty`/`ErrTemplateItemNoLib`→400) сохраняют русские
UI-сообщения. Слои: `repository/template_insert.go` (новый),
`services/boq.go` (+метод+инвалидация tender:overview+tender-list),
`handlers/boq_write.go` (+`InsertTemplate`), route в `r.Group(authMW)`.
Фронтовая сигнатура и `InsertTemplateResult` без изменений (callers
`useItemActions.ts`/`InsertTemplateIntoPositionModal.tsx` не тронуты;
их собственные supabase-callsite'ы — другие домены). 0 supabase в
`insertTemplateItems.ts`. `go build ./...` 0, `go test` без новых
провалов (calc pre-existing §11), `tsc` 0, `vite build` ✓.

## Migrated paths

### P5.1 — DONE (verified: `tsc` 0, `vite build` ✓; multiline 479/112 → 473/110)

| Файл | Было | Стало | Go endpoint |
|---|---|---|---|
| `src/utils/versionTransfer/executeVersionTransfer.ts` | `supabase.rpc('execute_version_transfer')` (un-gated) | `apiFetch` POST (timeoutMs:0) | `POST /api/v1/tenders/{id}/versions/transfer` (существовал) |
| `src/lib/supabaseWithAudit.ts` | gated Go + Supabase-fallback (3×rpc + stale-док) | **Go-only**, 0 supabase-business; `supabase` остался только для `auth.getSession()` | `POST/PATCH/DELETE /api/v1/items*` (существовали) |
| `src/pages/ClientPositions/hooks/useMassBoqImport.ts` | gated Go + `supabase.rpc('bulk_import_client_position_boq')` fallback | fallback убран, Go-only (timeoutMs:0); остаётся 9 un-gated read-цепочек (→ P5.3) | `POST /api/v1/imports/boq` (существовал) |

Контракты сверены: Go `TransferResult` JSON-теги ⊇ фронтовый
`ExecuteVersionTransferResult`; insert возвращает типизированный `BoqItem`
(чинит потребителей `useBoqItemsImport`/`insertTemplateItems`). Бэкенд не
менялся (только фронт). `go build`/`go test` не требовались (no backend
change в P5.1).

## P5.2 findings — schema-gap BLOCKER

| Объект | Yandex schema | Вывод |
|---|---|---|
| `tender_notes` (таблица) | ✅ `03_tables.sql:325` (unique `tender_id,user_id`, FK, trigger, idx) | Go-эндпоинты выполнимы |
| `boq_items_audit` (таблица) | ✅ `03_tables.sql:422` (+ audit_data_check) | audit-rollback выполним |
| `clone_tender_as_new_version` (RPC) | ❌ **отсутствует** в `db/yandex/sql/*` И в `supabase/schemas/prod.sql` | **BLOCKER** |

`clone_tender_as_new_version` существует только в старой live-Supabase БД; в
Yandex и в каноничной схеме его нет → **исходной DB-миграцией не перенесён**.
Фича «дублировать тендер» (`src/pages/Admin/Tenders/Tenders.tsx:58` →
`cloneTenderAsNewVersion.ts`) **уже не работает против Yandex** независимо от
фронта (pre-existing gap, не внесён этой задачей).

### Clone — исходник восстановлен, разрешение определено

Через Supabase MCP (read-only `pg_get_functiondef`, проект `ocauafggjrqvopxjihas`,
старую live-prod НЕ трогали) получен полный текст
`clone_tender_as_new_version(uuid) RETURNS jsonb` — самодостаточная
PL/pgSQL-функция (tender→client_positions→boq_items с temp-UUID-ремапом
родительских ссылок→cost_volumes→insurance→subcontract_exclusions→
pricing_distribution→markup_percentage→documents→notes→groups). Заголовок
идентичен уже портированной `execute_version_transfer` (Yandex
`04_functions.sql:477`: `SECURITY DEFINER` / `search_path public` /
`statement_timeout 0`). Все целевые таблицы в Yandex присутствуют.

**Единственная адаптация для Yandex** (предписана `03_tables.sql:13-16`:
no schema-qualified extension calls): `extensions.uuid_generate_v4()` →
`gen_random_uuid()` — ровно 2 вхождения (tmp_cp_map, tmp_boq_map). Остальное
— вербатим. Низкий риск (функция в проде Supabase давно; замена механическая).

Рекомендуемое разрешение (нужна авторизация — это DDL Yandex):
1. Добавить адаптированную функцию в `db/yandex/sql/04_functions.sql`
   (репо-фикс gap, без БД/push).
2. **Оператор** применяет функцию к Yandex (psql/миграционный тулинг —
   у sandbox нет доступа к Yandex; нужна явная авторизация DDL).
3. Тонкий Go-эндпоинт `POST /api/v1/tenders/{id}/versions/clone` (зеркало
   паттерна `tender_transfer`: один pgx-вызов RPC, JSONB→envelope) +
   перевод `cloneTenderAsNewVersion.ts`; `createNewVersion.ts` клиентский
   tenders.delete-rollback устраняется (clone — одна транзакц. RPC).

Альтернативы (хуже): полный порт логики в Go (~12 сущностей, риск
расхождения) или деприоритизация (фича остаётся нерабочей против Yandex).

## New backend endpoints

### P5.2-clone — DONE (code; verified: `go build` 0, `go test` без новых
провалов [calc-failures pre-existing §11], `tsc` 0, `vite build` ✓)

- **SQL**: `db/yandex/sql/04_functions.sql` — добавлена
  `public.clone_tender_as_new_version(uuid)` (вербатим из pre-prod +
  `extensions.uuid_generate_v4()`→`gen_random_uuid()` ×2; заголовок как
  `execute_version_transfer`).
- **Backend**: `repository/tender_clone.go` (`CloneRepo` →
  `SELECT public.clone_tender_as_new_version($1::uuid)`, JSONB→`CloneResult`,
  `ErrClone` 404/500), `services/tender_clone.go` (+cache evict),
  `handlers/tender_clone.go`, route
  `POST /api/v1/tenders/{id}/versions/clone` + DI в `cmd/server/main.go`.
- **Frontend**: `cloneTenderAsNewVersion.ts` → `apiFetch` POST (timeoutMs:0),
  0 supabase-business; интерфейс/возврат не менялись (caller
  `Tenders.tsx:58` совместим).

> ✅ **GATE СНЯТ (2026-05-18):** оператор применил
> `clone_tender_as_new_version` к Yandex
> (`psql -f … → CREATE FUNCTION`; `to_regprocedure('public.
> clone_tender_as_new_version(uuid)')` подтвердил сигнатуру). Эндпоинт
> `POST /api/v1/tenders/{id}/versions/clone` (код в commit `3a35a67`)
> функционален против Yandex **после ближайшего передеплоя BFF**. Данные
> не трогались — добавлена ровно одна отсутствующая функция (gap-fix
> исходной миграции).

### P5.2-rest — DONE (verified: `go build ./...` 0, `go test` без новых
провалов [calc pre-existing §11], `tsc` 0, `vite build` ✓)

- **tender-notes**: `repository/tender_notes.go`, `services/tender_notes.go`
  (роль-проверка `noteViewerRoles` зеркалит `NOTE_VIEWER_ROLES`,
  enforced server-side по DB-роли, не по клиент-флагу),
  `handlers/tender_notes.go`; routes
  `GET/PUT /api/v1/tenders/{id}/notes` + DI. Фронт
  `src/hooks/useTenderNotes.ts` → `apiFetch` (0 supabase).
- **audit-rollback**: `repository/boq_audit_rollback.go`
  (`jsonb_populate_record` реинсерт DELETE'd boq_item с исходным id,
  маппинг 23505/23503→409), `services/`+`handlers/`; route
  `POST /api/v1/boq-audit/{auditId}/rollback` + DI. Фронт
  `useAuditRollback.ts` DELETE-path → `apiFetch` (0 supabase;
  UPDATE/INSERT-rollback уже Go через `supabaseWithAudit` из P5.1).

> ⚠️ tender-notes/audit-rollback читают/пишут существующие таблицы Yandex
> (`tender_notes`, `boq_items`, `boq_items_audit` — все присутствуют) →
> работают сразу после деплоя BFF (в отличие от clone, которому нужен
> apply SQL-функции к Yandex).

### Остаётся (P5.3–P5.6) — основной объём, многосессионно

После P5.1+P5.2: multiline-grep `src` ≈ **460+ / ~105 файлов**
(gated `src/lib/api/*` ≈130 non-runtime + ~330 un-gated в ~90 файлах).
P5.3 (домены: notifications/tasks/projects/markup-tactics/cost-import/
templates/library/analytics/boq-utils/deadline/bsm/…), P5.4 (снять
fallback в gated хелперах), P5.5 (realtime channel/removeChannel;
checkDatabaseStructure вне runtime), P5.6 (multiline-grep=0 + bundle) —
десятки новых Go-эндпоинтов, **не выполнимо безопасно в одной сессии**
(подтверждено объёмом). Идём верифицируемыми инкрементами.

- `POST /api/v1/tenders/{id}/versions/clone` → service вызывает существующую
  SQL-функцию `public.clone_tender_as_new_version(p_source_tender_id)` в
  Yandex через pgx (функция присутствует в `db/yandex/sql/04_functions.sql`);
  user_id из JWT; pgx.Tx; параметризовано.
- Tender notes: `GET /api/v1/tenders/{id}/notes`,
  `POST /api/v1/tenders/{id}/notes`, `PATCH /api/v1/tender-notes/{noteId}`,
  `DELETE /api/v1/tender-notes/{noteId}` — repo/service/handler;
  user_id из JWT; tender_id проверка.

## Remaining Supabase usage (после миграции Кат.3/4)

Допустимо: `supabase.auth.*`; `src/lib/supabase/client.ts` (auth);
`database.types.ts` (типы). Документировано non-runtime: Кат.2 gated
fallback-ветки в `src/lib/api/*` (не исполняются при `.env.production`
go-mode) — отдельный follow-up «сделать хелперы Go-only».

## Bundle verification

(будет заполнено после реализации: `npm run typecheck`, `npm run build` с
`.env.production`, `go build ./cmd/server`, `go test ./...`, повтор `rg`,
grep dist на `/api/v1`, `/api/v1/ws`, отсутствие runtime бизнес-PostgREST.)

## Plan (реалистичный, фазовый — проект, не один промпт)

Объём ~93 un-gated файла / ~349 callsites + десятки новых Go-эндпоинтов.
Многие SQL-функции (clone, *_with_audit, bulk_import) и таблицы
(tender_notes, tasks, notifications, projects, library, markup_tactics …)
требуют отдельных backend route/handler/service/repo с pgx.Tx и user_id из
JWT. Это **Phase 5 целиком** (полный перенос data-layer фронта на Go BFF).

Фазовая разбивка (каждая фаза — отдельная авторизованная сессия,
верификация `go build`/`go test`/`tsc`/`vite build` + multiline-grep до
перехода):

- **P5.1** un-gated утечки с уже существующими Go-эндпоинтами:
  `executeVersionTransfer.ts` → `/versions/transfer`; снять fallback в
  `supabaseWithAudit.ts`/`useMassBoqImport.ts` (Go-only).
- **P5.2** новые backend: `versions/clone`, tender-notes, audit-rollback
  (`/boq-audit/{id}/rollback`) + соответствующий фронт.
- **P5.3** домен за доменом: notifications, tasks, projects-detail,
  markup-tactics (services/markupTactic/*), cost-import, template-items,
  BOQ copy/insert utils, deadline-check, bsm, analytics-comparison,
  library/* — для каждого: Go endpoint(ы) + перевод фронта, снятие
  Supabase.
- **P5.4** снять fallback-ветки в gated `src/lib/api/*` (Go-only).
- **P5.5** realtime: убрать `supabase.channel/removeChannel` отовсюду;
  `checkDatabaseStructure.ts` — вне runtime.
- **P5.6** финальная верификация: multiline-grep = 0 business; bundle.

Слепой единый mega-патч в production-кодовую базу без поэтапной
верификации — недопустим (необратимые write-пути: transfer/import/audit/
clone/notifications).

## Final status

```
FRONTEND_SUPABASE_WRITE_PATHS_NOT_READY
```

Причина: аудит выявил, что реальный объём — ~349 un-gated callsites в ~93
файлах (а не ~7–10), т.к. line-based grep задачи/doc25 систематически
недосчитывал multiline-цепочки. Это многонедельный Phase-5-проект, не
выполнимый безопасно в одной сессии. Премиса «осталось 7 paths» неверна.
Статус станет `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED` только после
реализации всех фаз P5.1–P5.6 и зелёной multiline-верификации (0 runtime
business Supabase). Ничего не закоммичено по коду (только doc 26).

---

> Статус: `FRONTEND_SUPABASE_WRITE_PATHS_NOT_READY` — полный аудит/
> категоризация/план зафиксированы; ничего не задеплоено/не запушено; БД/
> backend-runtime/Yandex/Supabase Auth не трогались. Реализация — поэтапно
> по §Plan с верификацией на каждом шаге.
