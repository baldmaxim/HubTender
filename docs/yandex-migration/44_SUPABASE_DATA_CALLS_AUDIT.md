# 44 — Supabase Data Calls Audit

> Forensic audit of remaining Supabase references in `src/` after the
> Auth-runtime removal in doc 43. Triggered by operator catching the
> misleading claim в doc 43 что «остаются ~80 `supabase.from()` call-sites».
> Этот документ объясняет, что эти 80+ совпадений на самом деле, и фиксирует
> финальное состояние удаления.

## TL;DR

**Активных Supabase data-вызовов (`supabase.from/rpc/channel/removeChannel`)
в `src/` — НОЛЬ.** Все они были портированы на Go BFF в Phase 5
(статус `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED`). Те «~80 файлов»,
которые упомянуты в первоначальной версии doc 43, — это **type-only
imports** (`import type { Tender, ClientPosition } from '../../lib/supabase'`),
которые TypeScript стирает на этапе компиляции и в production bundle не
попадают.

После реальной верификации SDK `@supabase/supabase-js` удалён, env-vars
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` сняты, бандл
полностью свободен от Supabase runtime.

## Почему появился неверный отчёт

Изначальный аудит в doc 43 использовал grep по импортным путям:

```
from ['"]@supabase/supabase-js['"]
| from ['"]\.\./supabase['"]
| from ['"]\.\./\.\./lib/supabase['"]
| ...
```

Этот паттерн матчит **любые** импорты из `lib/supabase`, включая чисто
типовые:

```ts
import type { Tender } from '../../lib/supabase';   // ← попадает в grep
```

TypeScript-only импорты стираются `tsc` ещё до того, как код увидит
Rollup/Vite. В JS-бандл они не попадают. Грубо говоря — это эквивалент
комментария «эта функция работает с типом Tender» в исходнике, который
после компиляции исчезает.

Правильный аудит должен был фильтровать `import type` или искать
**вызовы методов** на `supabase.X(...)`, а не импорты.

## Правильный аудит

### Метод 1 — вызовы методов SDK

```bash
$ rg "supabase\.(from|rpc|channel|removeChannel|auth|storage|functions)\(" src
# 0 matches
```

### Метод 2 — value-imports клиента `supabase`

```bash
$ rg "^import\s+\{\s*supabase\b" src
# 0 matches

$ rg "import\s+\{[^}]*\bsupabase\b" src --multiline
# 0 matches
```

### Метод 3 — единственное место, где `createClient` из SDK вызывался

```bash
$ rg "createClient\s*\(" src --type ts --type tsx
src/lib/supabase/client.ts:17:export const supabase = createClient(...)   # ← УДАЛЁН
```

После удаления `client.ts` — **0 вызовов** `createClient` в проекте.

### Метод 4 — все упоминания строки `supabase.` в коде

```bash
$ rg "supabase\." src --type ts --type tsx
src/lib/api/projects.ts:42:  // ─── Project reads (заменяют supabase.from в src/pages/Projects/) ───
src/lib/auth/client.ts:449: // Used by call sites that previously called supabase.auth.getUser() — those
```

Оба — комментарии-история (документируют, что когда-то здесь были вызовы;
сейчас нет).

## Что было найдено в импортах (правильная классификация)

Все 80+ файлов, импортирующих из `lib/supabase`, делятся на 3 категории:

| Категория | Описание | Пример | Runtime impact |
|---|---|---|---|
| **A. Type-only imports** | TS-типы (`Tender`, `ClientPosition`, `BoqItem`, etc.) | `import type { Tender } from '../../lib/supabase';` | ❌ Стираются tsc, в bundle 0 байт |
| **B. Value imports (хелперы)** | Утилиты `canManageUsers`, `hasPageAccess`, `ALL_PAGES`, `PAGE_LABELS` из `lib/supabase/types.ts` | `import { canManageUsers } from '../../lib/supabase/types';` | ✅ Попадают в bundle, но это **pure TS-функции**, ноль Supabase API |
| **C. Сам SDK client** | `import { supabase } from '../lib/supabase';` или `import { createClient } ...` | `src/lib/supabase/client.ts:1` (был) | **Был**: 1 файл (SDK init). **Стал**: 0 — удалён |

Категория A — 79 совпадений из 80+. Все safe — type-only.

Категория B — несколько совпадений с импортами хелперов из `types.ts`:
- `canManageUsers`, `hasPageAccess`, `ALL_PAGES`, `PAGE_LABELS`,
  `PAGES_STRUCTURE`, `canViewAllNotes`
- Это **обычные TypeScript-функции** в файле, который исторически назван
  `supabase/types.ts` (из-за того, что там же лежат типы таблиц).
- Реализация — pure JS логика, ZERO Supabase SDK calls.

Категория C — был только 1 файл (`src/lib/supabase/client.ts`),
который **никто не импортировал как value** — только сам барель
`src/lib/supabase/index.ts` его реэкспортировал, а потребители барелка
импортировали только **типы**. Удаление файла безопасно.

## Что удалено в этом раунде

| Файл | Действие |
|---|---|
| `src/lib/supabase/client.ts` | **Удалён.** Единственное место, вызывавшее `createClient` из `@supabase/supabase-js`. Никто не импортировал `supabase` как value. |
| `src/lib/supabase/index.ts` | Снят `export { supabase } from './client'`. Барель теперь чисто типовой. |
| `package.json` | `@supabase/supabase-js@^2.80.0` удалён из `dependencies`. |
| `package-lock.json` | `npm install` снял 9 пакетов (SDK + transitive deps). |
| `vite.config.ts` | Удалён manualChunk `'vendor-supabase': ['@supabase/supabase-js']` (vendor-supabase-*.js больше не эмитится). |
| `scripts/build-prod.mjs` | Удалена guard-проверка `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. |
| `.env.example` | Удалены `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` строки. |
| `.env.production.yandex.example` | То же + переписан комментарий вверху. |
| `.github/workflows/ci.yml` | Удалены `VITE_SUPABASE_*` placeholder env-vars из CI build step. |

Что **сохранено** (с обоснованием):

| Файл | Почему оставлен |
|---|---|
| `src/lib/supabase/types.ts` | TypeScript type definitions + pure-JS хелперы (`canManageUsers`, `hasPageAccess`, etc.). 80+ файлов импортируют отсюда; переименовать = большая churn-волна в diff. Папка теперь чисто типовая, имя «supabase» — исторический legacy. |
| `src/lib/supabase/database.types.ts` | Auto-generated типы из схемы (`npm run gen:types`). Используются хелперами в `lib/api/*.ts` для строгой типизации запросов к Go BFF. Файл — статический артефакт, генерация через Supabase CLI — лишь dev-удобство (тулчейн можно когда-нибудь перевести на yandex-pg-typed). |
| `src/lib/supabase/types/tasks.ts` | Task-specific TS-типы, аналогично. |
| `package.json` script `gen:types` | Запускается вручную разработчиком; в runtime не вызывается. Может быть переключён на Yandex-pg-источник схемы в будущем. Не блокер. |
| `tests/verify-admiral-calculation.spec.ts` + `tests/test-current-tactic.spec.ts` | Playwright тесты с `process.env.VITE_SUPABASE_*`. Они **не запускаются в CI** (нет `@playwright/test` в `devDependencies` per CLAUDE.md), не часть bundle, не блокер. Будут переписаны при следующей правке этих файлов или удалены вместе с переходом на иной test-стек. |
| Папка `supabase/` в корне (migrations, schemas) | Это Supabase CLI artefacts (хранилище миграций); они в runtime не влияют, используются для исторического трекинга схемы. |

## Bundle inspection после удаления

Build: `npm run build:prod` → `hubtender-web@b77b5ef` (1m 44s).

Bundle chunks:

```
dist/assets/
├─ index-tfMzqzG0.js       — main bundle (новый hash)
├─ index-ByJfc6rL.css
├─ vendor-react-DmUNdSi8.js
├─ vendor-antd-_NVMoKr0.js
├─ vendor-charts-A5uDls0t.js
├─ vendor-xlsx-Cd4JQgHx.js
├─ exportToExcel-B1GctST7.js
└─ worker-B7YgltGE.js
```

Note: **`vendor-supabase-*.js` chunk отсутствует** (был в предыдущей сборке).

Grep по всем JS-чанкам:

| Pattern | Hits |
|---|---|
| `supabase.co` | **0** |
| `/auth/v1/` | **0** |
| `/rest/v1/` | **0** |
| `GoTrueClient` | **0** |
| `@supabase` | **0** |
| `gotrue` | **0** |
| `postgrest` | **0** |
| `createClient` (в index) | 2 — это `createClientReportEnvelope` от **Sentry** SDK, не Supabase (verified context) |
| `signInWithPassword` | 2 — имя **нашей** app-auth функции (`src/lib/auth/client.ts`), не SDK |
| `onAuthStateChange` | 2 — имя **нашей** app-auth event-API, не SDK |

| App-auth endpoint inlined? | |
|---|---|
| `/api/v1/auth/login` | ✅ |
| `/api/v1/auth/register` | ✅ |
| `/api/v1/auth/forgot-password` | ✅ |
| `/api/v1/auth/reset-password` | ✅ |
| `/api/v1/auth/refresh` | ✅ |
| `/api/v1/auth/logout` | ✅ |
| `/api/v1/auth/me` | ✅ |

## Verification matrix

| Check | Command | Result |
|---|---|---|
| Active runtime supabase methods | `rg "supabase\\.(from\|rpc\|channel\|removeChannel\|auth\|storage\|functions)\\(" src` | 0 |
| `@supabase/supabase-js` imports | `rg "from\\s+['\"]@supabase/supabase-js['\"]" src` | 0 |
| `createClient(` calls in src | `rg "createClient\\s*\\(" src` | 0 |
| `VITE_SUPABASE` references in active runtime | `rg "VITE_SUPABASE" src backend .env.example .env.production.yandex.example` | 0 |
| `VITE_SUPABASE` in CI workflow | `rg "VITE_SUPABASE" .github/workflows/` | 0 |
| `SUPABASE_JWKS\|SUPABASE_JWT_ISSUER\|AUTH_MODE` in active runtime | `rg "..." backend src package.json` | 0 |
| Frontend typecheck (`tsc --noEmit`) | | ✅ clean |
| Frontend lint (`eslint --max-warnings 0`) | | ✅ |
| Frontend build (`npm run build:prod`) | | ✅ `hubtender-web@b77b5ef` |
| Backend build (`go build ./cmd/server`) | | ✅ |
| Backend tests | `go test ./internal/{auth,middleware,handlers,repository,services}` | ✅ all pass |
| Bundle: `supabase.co` | grep dist/assets/*.js | 0 |
| Bundle: `/rest/v1/` | grep | 0 |
| Bundle: `/auth/v1/` | grep | 0 |
| Bundle: app-auth endpoints | grep | all 7 inline |

## Связь с предыдущими migration milestones

- `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED` (Phase 5, archived doc 26) —
  устранил все write-вызовы фронта к Supabase. Этот документ подтверждает,
  что **никаких** runtime-вызовов (read OR write) не осталось.
- `APP_AUTH_*_OK` (docs 32-42) — устранили Auth runtime.
- **`SUPABASE_RUNTIME_REMOVED`** (doc 43, обновлён в этом раунде) —
  устранил SDK + env-vars.

## Что осталось как «namespace cleanup» (не блокер)

| Item | Severity | Notes |
|---|---|---|
| Переименовать `src/lib/supabase/` → `src/lib/types/` (или подобное) | P3 (cosmetic) | 80+ файлов нужно правнуть с новым импорт-путём. Лучше отложить до следующего раза, когда часть импортов всё равно будет тронута. |
| `npm run gen:types` всё ещё использует `supabase gen types typescript ...` | P3 | Это dev-команда, не runtime. Можно переключить на pgtyped/zapatos когда понадобится. Или оставить пока схема между Supabase pre-prod и Yandex prod синхронна. |
| `tests/*.spec.ts` с `process.env.VITE_SUPABASE_*` | P3 | Не запускается в CI (Playwright не в `devDependencies`). Будут переписаны при возрождении test-стека. |
| `supabase/migrations/`, `supabase/schemas/` в корне | P3 | Артефакты Supabase CLI; в runtime не используются. Можно архивировать или оставить как historical schema-snapshot. |

## Conclusion

Supabase runtime удалён полностью (Auth + Data + SDK + env-vars + bundle
chunk). Активная архитектура — только Go BFF + Yandex PostgreSQL +
RS256 app-auth. Остатки в кодовой базе — TypeScript-типы под старым
namespace + dev-tooling scripts; они **не попадают в bundle** и
**не вызывают Supabase API**.

Финальный статус: **SUPABASE_RUNTIME_REMOVED** (см. doc 43, обновлённый).
