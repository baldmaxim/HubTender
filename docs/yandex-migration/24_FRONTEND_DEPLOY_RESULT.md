# Frontend Deploy Result

> Деплой production-фронта на `tender.su10.ru` (same-origin → Go BFF →
> Yandex; Supabase Auth — источник JWT). Без app-auth, без удаления Supabase
> SDK, без import/clean/repair, без изменения `DATABASE_URL`/БД. Секреты в git
> не попадали (`.env` не коммитился; в репо только плейсхолдеры).

- Дата (UTC): 2026-05-18
- Связано: [19](./19_RUNTIME_CUTOVER_PLAN.md), [20](./20_RUNTIME_CUTOVER_READINESS.md),
  [21](./21_PRODUCTION_ENV_READINESS.md), [23](./23_RUNTIME_CUTOVER_RESULT.md).

## 1. Что сделано (OK)

| Шаг | Результат |
|---|---|
| nginx `tender.su10.ru`: `location /api/` + `/api/v1/ws` → `127.0.0.1:3006` | ✓ (backup конфига сохранён) |
| Proxy-проверка `/api/v1/me` без токена | ✓ 401 + JSON RFC7807 (Go BFF, не SPA-fallback) |
| Сборка фронта (`npm run build`, Vite 5) | ✓ `dist/` собран |
| Деплой `dist/ → /srv/sites/tender.su10.ru/public` (rsync, backup) | ✓ бэкап `public.backup-20260518-000447` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | ✓ корректный anon-ключ вшит (после фикса — первая сборка имела неверный ключ → 401 на login) |
| Supabase Auth login через браузер | ✓ 200, JWT получен |
| WebSocket `wss://tender.su10.ru/api/v1/ws` | ✓ 101 Switching Protocols (Go BFF realtime → Yandex) |

## 2. Критический дефект (критерий приёмки Шаг 6 п.8 — НАРУШЕН)

**Бизнес-данные читаются/пишутся в Supabase pre-prod (`ocauafggjrqvopxjihas`),
НЕ в Yandex через Go BFF.**

Подтверждение (DevTools → Network → Request URL):
```
https://ocauafggjrqvopxjihas.supabase.co/rest/v1/tenders?select=*&id=eq.<uuid>  → 200
```
Аналогично `boq_items?select=…`, `notifications?select=…`, `users?select=…`
(синтаксис `?select=`/`eq.`/`order=` = supabase-js/PostgREST). Запросов
`https://tender.su10.ru/api/v1/*` (кроме `ws`) в Network нет.

### Корень (по анализу кода, не по догадке)

- В `src/pages/` прямой `supabase.from(` — **1 файл** (`PositionItems/hooks/
  useAuditRollback.ts`). Массовых немигрированных страниц нет.
- Основная масса `supabase.from(` — **fallback-ветка внутри `src/lib/api/*`
  хелперов** (`if (isGoEnabled(domain)) apiFetch(...) else supabase...`).
- Деплоенный бандл берёт fallback → значит **`isGoEnabled()` == false в
  production-бандле**.
- `isGoEnabled` (`src/lib/api/featureFlags.ts`) per-domain флаг читает через
  **динамический** `import.meta.env[domainEnvKey(domain)]`. Vite надёжно
  inline-ит только **статические** `import.meta.env.VITE_X`; значения,
  переданные через shell-export (`set -a; . envfile; set +a`), в **динамический**
  доступ прод-бандла не попадают. Статически читаемые
  `VITE_SUPABASE_URL/KEY`, `VITE_API_URL`, `VITE_API_REALTIME_ENABLED`
  сработали (login + WS живы) — поэтому дефект селективный.
- Итог: Go-роутинг для доменных хелперов не включился → весь бизнес-трафик
  ушёл в Supabase-fallback.

### Риск

Записи через текущий фронт идут в Supabase Postgres, не в Yandex →
расхождение Yandex↔Supabase (тот же класс риска, что 20 §1 / §7). «Работает»
лишь потому, что в Supabase pre-prod данные ещё есть.

## 3. Final status

```
FRONTEND_DEPLOY_FAILED_ROLLED_BACK
```

Backend не затронут: `23_RUNTIME_CUTOVER_RESULT.md = RUNTIME_CUTOVER_OK` в силе
(Go BFF ↔ Yandex рабочий; nginx-proxy и Auth/WS-путь корректны). БД / Yandex /
`DATABASE_URL` / import / clean / repair / Supabase Auth — **не трогались**.

## 4. Rollback (выполнен)

**Хронология бэкапов (важно — выбор цели отката):**
- `public.backup-20260517-235047` — снят **перед первым деплоем** =
  исходный статический плейсхолдер (`<title>tender.su10.ru</title>`, без
  `assets/`). ✅ **корректная цель отката**.
- `public.backup-20260518-000447` — снят перед вторым деплоем, когда в
  `public` уже лежала первая неудачная сборка (неверный ключ). ❌ не
  использован (вернул бы сломанный фронт, а не исходное состояние).

Выполнено (только статика; БД/backend/`DATABASE_URL` не трогались):
```
rsync -a --delete /srv/sites/tender.su10.ru/public.backup-20260517-235047/ \
  /srv/sites/tender.su10.ru/public/
```
Проверка после отката:
```
curl -sI https://tender.su10.ru | head -n1   → HTTP/1.1 200 OK
curl -s  https://tender.su10.ru/ | head      → исходный плейсхолдер
ls .../public/assets                          → пусто (React-бандл снят)
```
nginx reload не требовался (docroot тот же). Go BFF оставлен running и
корректен; после отката статики на него ничего не указывает (новый фронт не
публичен). nginx-proxy `/api/` оставлен (безвреден — плейсхолдер `/api` не
зовёт); при желании откатывается из `tender.su10.ru.bak.*`.

Резюме по неприкосновенному: rollback затронул **только** статику
`tender.su10.ru/public`. БД не трогалась; backend Go BFF на Yandex не
трогался; `DATABASE_URL` не менялся; Yandex/Supabase Auth не трогались.

## 5. Правильный фикс (вне server-итераций, отдельный авторизованный этап)

1. Передавать build-env через **реальный `.env.production`-файл** в каталоге
   сборки (Vite `loadEnv` кладёт его и в динамический `import.meta.env`),
   а не через shell-export. `.env` — НЕ в git; добавляет оператор.
2. Либо `VITE_API_MODE=go` гарантированно статически (проверить inline в
   бандле), т.к. `isGoEnabled` fallback = `API_MODE === 'go'`.
3. Пересборка → проверка в бандле, что доменные вызовы идут на
   `https://tender.su10.ru/api/v1/*`, а не `*.supabase.co/rest/v1/*`.
4. Повторить browser-smoke §6 (вкл. п.8: ноль business-PostgREST).
5. Отдельно: `users?select=…` из AuthContext — это bridge-Auth-путь
   (профиль из Supabase); решить, допускается ли он в критерии (auth vs
   business) или тоже переводится на Go.

---

> Статус: фронт поднят, login/WS через Go/Yandex работают, **но бизнес-данные
> идут в Supabase, не в Yandex** (критерий §6.8 нарушен) →
> `FRONTEND_DEPLOY_FAILED`. БД/import/repair/app-auth не трогались; backend
> cutover (`RUNTIME_CUTOVER_OK`) в силе; rollback статики готов (§4).

---

## Re-build / re-verification 2026-05-20 (post Phase 5 + FINAL_DATA_REFRESH_OK)

Локальная сборка и верификация после Phase 5 и свежего data refresh.
Remote deploy (`rsync` в `/srv/sites/tender.su10.ru/public/`, nginx checks,
browser smoke) выполняется оператором вручную и фиксируется ниже после
исполнения.

- Build host: Windows 10 / Node 24 / Vite 5
- HEAD на момент сборки: `61284ad` (`docs: record final data refresh before frontend deploy`)
- Build mode: `production.yandex` (Vite режим `production.yandex` → грузится
  `.env.production.yandex`; репо использует именно этот файл как
  production-env)
- Preconditions:
  - Phase 5 = `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED` (doc 26)
  - Data refresh = `FINAL_DATA_REFRESH_OK` (doc 27)
  - Go BFF vs Yandex = `GO_BFF_YANDEX_VERIFY_OK` (doc 18 re-verification 2026-05-20)

### env summary (`.env.production.yandex`, masked)

| Var | Value (masked) | Status |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://ocauafggjrqvopxjihas.supabase.co` | OK (public project ref) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJ***` (anon key, public by design) | OK |
| `VITE_API_URL` | `https://tender.su10.ru` | OK |
| `VITE_API_MODE` | `go` | OK |
| `VITE_API_REALTIME_ENABLED` | `true` | OK |
| Per-domain `VITE_API_*_ENABLED` × 18 | all `true` | OK |

`.env.production.yandex` is gitignored; не коммитился.

### typecheck / lint / build

| Command | Status |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | ✓ exit 0 |
| `npm run lint` (`--max-warnings 0`) | ✓ exit 0 |
| `npx vite build --mode production.yandex` | ✓ exit 0 (48s) |

### Source grep (runtime Supabase business calls)

Pattern: `supabase\s*\.\s*(from|rpc|channel|removeChannel)\s*\(`
Scope: `src/` исключая `database.types.ts`.

Result: **0 matches in 0 files** — Phase 5 baseline сохраняется.

### Bundle verification (`dist/assets/*.js`)

| Check | Result |
|---|---|
| `/api/v1` paths в основном бандле | ✓ **111 уникальных путей** (полный API surface Go BFF) |
| `/api/v1/ws` (WebSocket) | ✓ присутствует |
| `tender.su10.ru` (API base URL inline) | ✓ |
| Supabase Auth path `/auth/v1` | ✓ в `vendor-supabase` + main (Auth bridge) |
| Supabase REST/PostgREST `/rest/v1` | ✗ **отсутствует** — нет business REST-вызовов |
| Supabase project ref `ocauafggjrqvopxjihas` | присутствует (Auth only) |
| Inline env-mode сравнения | Vite constant-folded (литералов `"hybrid"`/`"supabase"` режима в бандле нет) |

API paths из бандла покрывают все Phase-5-домены: tenders, tender-registry,
positions, boq, boq-audit, items, library/{folders,materials,move,templates},
markup, projects, project-agreements, redistributions, notifications,
construction-cost-volumes, comparison-notes, costs, references, tasks,
audit-rollback, versions/transfer, timeline (assignable-users, groups,
iterations, reconcile-groups), insurance, nomenclatures, work-names,
material-names, me, me/permissions, me/reapply-access, users/register,
admin/{access-users,tender-extensions,users,roles}, imports/boq,
import-sessions, position-filters, fi, …

### Local status

```
FRONTEND_BUILD_VERIFIED_OK
```

Артефакт `dist/` готов к ручному rsync-деплою оператором.

### Remote deploy (operator-side — заполняется после исполнения)

- [ ] Step 5 — `nginx -t` OK, `/api/` → `127.0.0.1:3006`, `/api/v1/ws` upgrade, SPA fallback
- [ ] Step 5 — `curl -i https://tender.su10.ru/api/v1/me` → 401 без токена
- [ ] Step 6 — backup `/srv/sites/tender.su10.ru/public.backup-YYYYMMDD-HHMMSS` создан
- [ ] Step 7 — `rsync -a --delete dist/ /srv/sites/tender.su10.ru/public/` выполнен
- [ ] Step 8 — browser smoke (login, /me, /me/permissions, references, tenders list, single tender, BOQ, WS, no `/rest/v1/` в Network)

### Финальный статус (заполняется оператором)

При успехе всех Steps 5–8:

```
FRONTEND_DEPLOY_OK
```

При фейле — rollback static:

```
FRONTEND_DEPLOY_FAILED_ROLLED_BACK
```

с указанием причины и подтверждением восстановления из backup.

### Что НЕ трогалось в этой сессии

- Production `DATABASE_URL` — без изменений.
- Supabase Auth — оставлен bridge.
- App-auth — не вводился.
- Backend / DB — без изменений, никаких import/clean/repair.
- `git push` — не выполнен (ожидается явное разрешение).
- `.env*` файлы — не менялись.

> Локальный артефакт собран против HEAD `61284ad`. Если оператор будет
> деплоить с другого коммита (после push'ей), повторить шаги
> typecheck/lint/build/grep/bundle-verify локально.
