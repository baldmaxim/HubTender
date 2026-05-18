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
