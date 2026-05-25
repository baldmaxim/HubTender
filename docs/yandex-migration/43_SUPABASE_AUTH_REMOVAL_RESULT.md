# 43 — Supabase Runtime Removal Result

> Полное удаление Supabase из активного runtime: Auth + Data + SDK + env
> vars. Backend больше не верифицирует Supabase JWT; frontend больше не
> вызывает `supabase.auth.*` и `supabase.from()` ни на одном кодовом
> пути; `@supabase/supabase-js` снят из `package.json`; bundle не
> содержит ни одного байта Supabase SDK.

## Final status

**SUPABASE_RUNTIME_REMOVED** — Supabase runtime устранён из активного
проекта на всех уровнях: backend (`/auth/v1/*` верификация ушла, JWKS
keyfunc снят, AUTH_MODE-ветвление удалено), frontend (`supabase.auth.*`
и `supabase.from()` имеют 0 активных call-site'ов), SDK
(`@supabase/supabase-js` removed from `package.json`, `npm install`
снёс 9 пакетов, `vendor-supabase-*.js` chunk больше не эмитится), env
(VITE_SUPABASE_URL/KEY, SUPABASE_JWKS_URL/JWT_ISSUER, AUTH_MODE,
VITE_AUTH_MODE — все ушли). Bundle verified clean (0 occurrences of
`supabase.co`, `/auth/v1/`, `/rest/v1/`, `GoTrueClient`).

История неверного начального статуса и forensic-аудит — см.
[44_SUPABASE_DATA_CALLS_AUDIT.md](44_SUPABASE_DATA_CALLS_AUDIT.md).

## Что удалено

### Backend (Go)

| Файл | Изменение |
|---|---|
| [`backend/internal/middleware/auth.go`](../../backend/internal/middleware/auth.go) | Удалены `AuthMode` enum (`supabase`/`dual`/`app`), `ParseAuthMode`, `supabaseClaims`, `verifySupabaseToken`, `peekIssuer`, поля `SupabaseKeyfunc`/`SupabaseIssuer`/`Mode` в `VerifyConfig`. `VerifyToken` теперь вызывает только `verifyAppToken`. Импорт `github.com/MicahParks/keyfunc/v3` удалён. |
| [`backend/internal/middleware/auth_test.go`](../../backend/internal/middleware/auth_test.go) | Удалены `TestParseAuthMode` + три dual/supabase-mode test case'а. Добавлен `TestVerifyToken_MissingPublicKeyFails`. |
| [`backend/internal/config/config.go`](../../backend/internal/config/config.go) | Удалены `SupabaseJWKSURL`, `SupabaseJWTIssuer`, `AuthMode` поля + их env-загрузка (`SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `AUTH_MODE`). `APP_JWT_*` валидация теперь безусловная. `JWKSRefreshInterval` снят. |
| [`backend/cmd/server/main.go`](../../backend/cmd/server/main.go) | Удалены `keyfunc.NewDefault(...)`, `ParseAuthMode`, ветвление `if authMode == AuthModeSupabase/Dual`, conditional-guards `if authH != nil`. |
| [`backend/internal/handlers/ws.go`](../../backend/internal/handlers/ws.go) | docstring обновлён (verifyCfg больше не «dual-mode»). |
| `backend/go.mod` / `backend/go.sum` | `go mod tidy` удалил `github.com/MicahParks/keyfunc/v3` + transitive `github.com/MicahParks/jwkset`. |

### Frontend (TypeScript)

| Файл | Изменение |
|---|---|
| `src/lib/auth/mode.ts` | **Удалён** (был источник `AUTH_MODE` константы). |
| `src/lib/supabase/client.ts` | **Удалён.** Был единственным местом, вызывавшим `createClient` из SDK. |
| [`src/lib/supabase/index.ts`](../../src/lib/supabase/index.ts) | Снят `export { supabase } from './client'`. Барель теперь чисто типовой; добавлен комментарий с пояснением, почему имя папки оставлено. |
| [`src/lib/auth/types.ts`](../../src/lib/auth/types.ts) | Удалён тип `AuthMode = 'supabase' \| 'app'`. |
| [`src/contexts/AuthContext.tsx`](../../src/contexts/AuthContext.tsx) | Удалены `supabase.auth.getSession()`, `supabase.auth.signOut()`, `supabase.auth.onAuthStateChange()`. Импорт `supabase` снят. |
| [`src/lib/api/client.ts`](../../src/lib/api/client.ts) | `getToken()` больше не вызывает `supabase.auth.getSession()`. 401-retry не ветвится. |
| [`src/lib/realtime/ws.ts`](../../src/lib/realtime/ws.ts) | `connect()` берёт токен только из `appAuthGetAccessToken()`. |
| [`src/lib/supabaseWithAudit.ts`](../../src/lib/supabaseWithAudit.ts) | `getAuditAccessToken()` упрощён до `return appAuthGetAccessToken()`. Импорт `supabase` снят. (Модуль остаётся deprecated до миграции 4 call-site'ов в `src/pages/PositionItems/` — см. F18.) |
| [`src/pages/Auth/Login.tsx`](../../src/pages/Auth/Login.tsx) | Удалены `supabase.auth.signInWithPassword` + три inline `supabase.auth.signOut()`. |
| [`src/pages/Auth/Register.tsx`](../../src/pages/Auth/Register.tsx) | Удалена ветка `supabase.auth.signUp()` + post-create `signOut()`. |
| [`src/pages/Auth/ForgotPassword.tsx`](../../src/pages/Auth/ForgotPassword.tsx) | Удалена ветка `supabase.auth.resetPasswordForEmail()`. |
| [`src/pages/Auth/ResetPassword.tsx`](../../src/pages/Auth/ResetPassword.tsx) | Удалён `ResetPasswordSupabase` компонент целиком. Остался только `ResetPasswordApp`. |
| [`src/pages/CostRedistribution/hooks/useSaveResults.ts`](../../src/pages/CostRedistribution/hooks/useSaveResults.ts) | Удалена ветка `supabase.auth.getUser()`. |

### Build / tooling / CI

| Файл | Изменение |
|---|---|
| [`package.json`](../../package.json) | Удалена зависимость `@supabase/supabase-js@^2.80.0`. |
| `package-lock.json` | `npm install` снял 9 пакетов (SDK + transitive). |
| [`vite.config.ts`](../../vite.config.ts) | Удалён manualChunk `'vendor-supabase': ['@supabase/supabase-js']` — `vendor-supabase-*.js` больше не эмитится. |
| [`scripts/build-prod.mjs`](../../scripts/build-prod.mjs) | Удалена guard-проверка VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (env-vars больше не нужны). |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | Удалены placeholder `VITE_SUPABASE_*` env-vars из CI build step. |

### Env / Docs

| Файл | Изменение |
|---|---|
| [`.env.example`](../../.env.example) | Удалены `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Добавлены `APP_JWT_*`, `APP_ENV`, `APP_BASE_URL`, `SMTP_*` секции. |
| [`.env.production.yandex.example`](../../.env.production.yandex.example) | Удалены `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` + `VITE_AUTH_MODE`. Переписан комментарий вверху. |
| [`docs/RUNTIME_ENV.md`](../RUNTIME_ENV.md) | Backend таблица: `SUPABASE_JWKS_URL` / `SUPABASE_JWT_ISSUER` → удалены, добавлены `APP_JWT_*`. Frontend: пометка что SDK больше не используется. |
| [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) | Auth model section переписан под app-only. ASCII topology обновлён (вместо «Supabase Auth bridge» — «App-auth client»). Раздел «Что НЕ используется» обновлён. |
| [`CLAUDE.md`](../../CLAUDE.md) | Снят текст «Supabase Auth остаётся временным bridge». Описание AuthContext под app-auth. |
| [`README.md`](../../README.md) | Описание стека: убрано упоминание Supabase Auth + Realtime, добавлено app-auth + native WS. |

## Diff summary

```
27 files changed, ~400 insertions, ~1050 deletions
```

Net negative ~650 LOC — типично для cleanup'а dual-mode bridge'а +
removal SDK.

## Env после cleanup

### Backend (`/srv/sites/tender.su10.ru/server/.env.prod`)

Удалено / больше не читается:

```diff
- AUTH_MODE=app
- SUPABASE_JWKS_URL=https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json
- SUPABASE_JWT_ISSUER=https://ocauafggjrqvopxjihas.supabase.co/auth/v1
- SUPABASE_JWT_SECRET=...
```

Безусловно требуется (валидация при startup):

```
DATABASE_URL=…
APP_JWT_ISSUER=https://tender.su10.ru
APP_JWT_AUDIENCE=hubtender-web
APP_JWT_KEY_ID=<kid>
APP_JWT_PRIVATE_KEY_PATH=/srv/sites/tender.su10.ru/server/app-jwt.pem
APP_ACCESS_TOKEN_TTL_MINUTES=15
APP_REFRESH_TOKEN_TTL_DAYS=30
APP_ENV=production
APP_BASE_URL=https://tender.su10.ru
CORS_ORIGINS=https://tender.su10.ru
PORT=3005
BIND_HOST=0.0.0.0
SENTRY_DSN=…
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=hubtender-api@<git-sha>
```

### Frontend (`.env.production.yandex`)

Удалено:

```diff
- VITE_AUTH_MODE=app
- VITE_SUPABASE_URL=https://ocauafggjrqvopxjihas.supabase.co
- VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

Без изменений:

```
VITE_API_URL=https://tender.su10.ru
VITE_API_MODE=go
VITE_API_REALTIME_ENABLED=true
VITE_API_<DOMAIN>_ENABLED=true × 18
```

## Оставшиеся Supabase references (НЕ runtime)

Эти артефакты сохранены сознательно, описание — в
[44_SUPABASE_DATA_CALLS_AUDIT.md](44_SUPABASE_DATA_CALLS_AUDIT.md):

```
src/lib/supabase/
├─ index.ts            — barrel (только types reexport)
├─ types.ts            — TypeScript типы + pure-JS хелперы (canManageUsers, hasPageAccess)
├─ database.types.ts   — auto-generated DB-схема (для строгой типизации Go BFF helpers)
└─ types/tasks.ts      — Task-specific типы

supabase/              — Supabase CLI artefacts (migrations + schema snapshot). Не в bundle.

tests/*.spec.ts        — Playwright тесты (не в CI, не в bundle)

package.json:
  "gen:types"          — dev-команда, не runtime
  "gen:schema"         — то же

scripts/app-auth/      — dev-скрипты с DSN из .env (не часть bundle)
archive/migrations/    — историческая миграционная документация
```

Все эти референсы — **dev tooling и type definitions**, не runtime код.

## Результаты grep

### Active runtime

```bash
$ rg "supabase\.(from|rpc|channel|removeChannel|auth|storage|functions)\(" src
(0 matches)

$ rg "@supabase/supabase-js|VITE_SUPABASE|SUPABASE_JWKS|SUPABASE_JWT_ISSUER|AUTH_MODE|VITE_AUTH_MODE" \
    backend src \
    .env.example .env.production.yandex.example \
    package.json \
    .github/workflows/ci.yml
(0 matches)

$ rg "createClient\s*\(" src
(0 matches)

$ rg "AuthMode|ParseAuthMode|SupabaseKeyfunc|SupabaseIssuer|keyfunc" backend
(0 matches)

$ rg "supabase\." src
src/lib/api/projects.ts:42:  // ─── Project reads (заменяют supabase.from в src/pages/Projects/) ─
src/lib/auth/client.ts:449: // Used by call sites that previously called supabase.auth.getUser() —
                            (оба — комментарии-история, не активные вызовы)
```

## Tests / build / typecheck / lint

| Check | Result |
|---|---|
| `gofmt -l` (touched files) | ✅ clean |
| `go build ./cmd/server` | ✅ |
| `go test ./internal/auth ./internal/middleware ./internal/handlers ./internal/repository ./internal/services` | ✅ all pass (auth: 15.4s, middleware: 1.8s) |
| `go mod tidy` | ✅ removed `keyfunc/v3` + `jwkset` |
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint -- --max-warnings 0` | ✅ |
| `npm install` (после удаления `@supabase/supabase-js`) | ✅ removed 9 packages |
| `npm run build:prod` | ✅ `hubtender-web@b77b5ef` (1m 44s), Sentry sourcemaps uploaded |

## Bundle verification

Bundle: `dist/assets/`:

```
index-tfMzqzG0.js
index-ByJfc6rL.css
vendor-react-DmUNdSi8.js
vendor-antd-_NVMoKr0.js
vendor-charts-A5uDls0t.js
vendor-xlsx-Cd4JQgHx.js
exportToExcel-B1GctST7.js
worker-B7YgltGE.js
```

**`vendor-supabase-*.js` chunk отсутствует** (был в предыдущей сборке —
теперь сам SDK снят из проекта).

| Pattern | Count в bundle |
|---|---|
| `supabase.co` | **0** |
| `/auth/v1/` | **0** |
| `/auth/v1/token` | **0** |
| `/auth/v1/recover` | **0** |
| `/auth/v1/signup` | **0** |
| `/rest/v1/` | **0** |
| `GoTrueClient` | **0** |
| `@supabase` | **0** |
| `gotrue` | **0** |
| `postgrest` | **0** |
| `createClient` (2 hits) | ⚠ это **Sentry** `createClientReportEnvelope`, не Supabase (verified context) |
| `signInWithPassword` (2 hits) | ⚠ имя **нашей** app-auth функции (`src/lib/auth/client.ts`), не SDK |
| `onAuthStateChange` (2 hits) | ⚠ имя **нашей** app-auth event-API, не SDK |
| `/api/v1/auth/login` | ✅ inline |
| `/api/v1/auth/register` | ✅ inline |
| `/api/v1/auth/forgot-password` | ✅ inline |
| `/api/v1/auth/reset-password` | ✅ inline |
| `/api/v1/auth/refresh` | ✅ inline |
| `/api/v1/auth/logout` | ✅ inline |
| `/api/v1/auth/me` | ✅ inline |

## Production deploy recommendation

**Не деплоить в этом промте** (per spec).

Для следующего деплоя (на отдельное подтверждение):

1. Перед `bash scripts/deploy-production.sh both` оператор удаляет три
   переменные из `/srv/sites/tender.su10.ru/server/.env.prod`:
   ```
   AUTH_MODE
   SUPABASE_JWKS_URL
   SUPABASE_JWT_ISSUER
   ```
   и из `/srv/sites/tender.su10.ru/server/.env.production` (фронт-build env)
   удалить:
   ```
   VITE_AUTH_MODE
   VITE_SUPABASE_URL
   VITE_SUPABASE_PUBLISHABLE_KEY
   ```
   BFF и фронт-сборка пройдут без них нормально — переменные больше не
   читаются. Удаление чисто для гигиены.

2. `systemctl restart hubtender-bff.service` после rebuild image. Лог
   `password-recovery flow configured` должен по-прежнему показать
   `mailer_configured=false, app_env=production, app_base_url=https://tender.su10.ru`.

3. Public probes (можно сразу после restart):
   ```bash
   curl -sS https://tender.su10.ru/.well-known/jwks.json | head -c 60
   curl -sS -X POST -H 'Content-Type: application/json' -d '{}' \
     https://tender.su10.ru/api/v1/auth/login           # → 401 invalid credentials
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"email":"test@example.com"}' \
     https://tender.su10.ru/api/v1/auth/forgot-password # → 503 email_provider_not_configured
   ```

4. Frontend browser smoke (за оператором):
   - `/login` → submit реальные креды → 200, `Authorization` в Network → app JWT
   - **0 запросов** к `*.supabase.co/auth/v1/*` ИЛИ `*.supabase.co/rest/v1/*`
   - **0 запросов** к чему-либо на домене `supabase.co`
   - Reload страницы → сессия восстанавливается (app-auth localStorage)
   - Все бизнес-страницы (tenders, positions, BOQ, redistribution,
     commerce) работают без регрессий

## Rollback note

Если что-то пошло не так в production:

- **Frontend**: redeploy предыдущего bundle
  (`/srv/sites/tender.su10.ru/backups/public/public.backup-20260525-105041`
  или раньше). Старый bundle всё ещё содержит supabase-js и
  `VITE_SUPABASE_*` env-vars; если в `.env.production` оператор уже
  удалил их — старый bundle при load'е бросит «Supabase configuration
  is missing». Решение: при rollback также **восстановить** env-vars в
  `.env.production`, или просто оставить их в env до окончания
  обкатки.
- **Backend**: `git revert` коммита с этим cleanup'ом и re-deploy.
  Старый middleware работал в `AUTH_MODE=app` — обратная совместимость
  гарантирована.
- **DB**: схема не менялась; `app_auth.*` таблицы остаются. Никаких
  миграций для rollback не нужно.
- **package.json**: при rollback `npm install` восстановит supabase-js.

## Что НЕ сделано (по спеке)

| # | Item | Reason |
|---|---|---|
| F18 | Удалить `src/lib/supabaseWithAudit.ts` | Депрекейтнуто, всё ещё импортируется 4 call-site'ами в `src/pages/PositionItems/`. Заменить их на typed wrappers в `src/lib/api/boq.ts` — отдельная задача. Этот файл больше не вызывает Supabase API, только Go BFF. |
| F19 | Снести `auth.users` / `auth.identities` из Yandex DB | Нет — `public.users.id` имеет FK на `auth.users.id` для исторической совместимости. Сначала надо переразрезать FK на новую schema (или drop FK). Не в этой фазе. |
| F20 | Переименовать `src/lib/supabase/` → `src/lib/types/` | Cosmetic. 80+ файлов нужно правнуть. Лучше отложить — при следующих изменениях этих файлов всё равно будут import path adjustments. |
| F21 | Удалить `package.json` scripts `gen:types` / `gen:schema` (используют Supabase CLI) | Это **dev-команды**, в runtime не вызываются. Можно переключить на pgtyped/zapatos в будущем, или оставить пока схема между Supabase pre-prod и Yandex prod синхронна. |
| F22 | Удалить `tests/*.spec.ts` с `process.env.VITE_SUPABASE_*` | Тесты не запускаются в CI (Playwright не в `devDependencies`). Будут переписаны при возрождении test-стека. |

## Blockers / warnings

Блокеров для production deploy нет. После применения env-cleanup'a на
проде (см. recommendation) поведение наружу не изменится.

## Related docs

- [29_APP_AUTH_SCHEMA_PLAN.md](29_APP_AUTH_SCHEMA_PLAN.md) — DB-схема plan
- [32_APP_AUTH_BACKEND_MVP_RESULT.md](32_APP_AUTH_BACKEND_MVP_RESULT.md) — backend MVP
- [34_FRONTEND_APP_AUTH_MVP_RESULT.md](34_FRONTEND_APP_AUTH_MVP_RESULT.md) — frontend MVP
- [38_APP_AUTH_CUTOVER_RESULT.md](38_APP_AUTH_CUTOVER_RESULT.md) — production cutover
- [41_APP_AUTH_REGISTER_RESULT.md](41_APP_AUTH_REGISTER_RESULT.md) — register endpoint
- [42_APP_AUTH_PASSWORD_RECOVERY_RESULT.md](42_APP_AUTH_PASSWORD_RECOVERY_RESULT.md) — password recovery + production guard
- **43 (this)** — Supabase runtime removal
- [44_SUPABASE_DATA_CALLS_AUDIT.md](44_SUPABASE_DATA_CALLS_AUDIT.md) — forensic audit + correction of misleading initial 43 status
