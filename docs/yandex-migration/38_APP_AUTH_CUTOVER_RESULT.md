# 38 — App-Auth Production Cutover Result

> Phase 6 production auth cutover выполнен. `tender.su10.ru` теперь логинит
> через Go BFF (`/api/v1/auth/*`); Supabase Auth больше не вызывается
> для login/logout в app-mode-фронте. Supabase SDK + bridge остаются в
> коде как fallback на переходный период.

## Final status

**APP_AUTH_CUTOVER_OK**

## Timeline (UTC, 2026-05-23)

| Время | Событие |
|---|---|
| ≈14:34 | Локальный pre-flight: typecheck / lint / go build / `go test ./internal/auth ./internal/middleware` зелёные |
| ≈14:36 | Frontend redeploy (после операторского фикса `VITE_AUTH_MODE=app` в `/opt/hubtender-build/.env.production.yandex`): release `hubtender-web@74f399a`, backup `public.backup-20260523-164121`, rsync OK |
| ≈14:37 | Первый browser-probe: фронт уже стучится в `/api/v1/auth/login`, но BFF возвращает 404 — `AUTH_MODE` ещё `supabase` |
| ≈14:40 | Backend cutover (оператор): `.env.prod` обновлён с `AUTH_MODE=dual` + `APP_JWT_*` + `APP_JWT_PRIVATE_KEY_PATH`, `bash scripts/deploy-production.sh backend` (docker rebuild + systemctl restart) |
| ≈14:42 | nginx location для `/.well-known/jwks.json` поднят (бэкап старого конфига вынесен в `/root/nginx-backups`, `nginx -t` OK, `systemctl reload nginx`) |
| ≈14:43 | Публичные probe'ы зелёные (см. Backend section) |
| ≈14:50 | Browser smoke оператора — 16/16 PASS |

## Backend cutover

### Endpoints live (probed from public internet)

| Endpoint | HTTP | Response | Verdict |
|---|---|---|---|
| `GET https://tender.su10.ru/.well-known/jwks.json` | 200 | `application/json` `{"keys":[{"kty":"RSA","alg":"RS256","kid":"gpJuRL85…",…}]}` | JWKS published, kid `gpJuRL85...` |
| `POST https://tender.su10.ru/api/v1/auth/login` (empty body) | 401 | `{"detail":"invalid credentials"}` (RFC 7807 from our handler) | route registered, handler responds |
| `POST https://tender.su10.ru/api/v1/auth/refresh` (empty body) | 401 | `{"detail":"invalid or expired refresh token"}` | route registered |
| `POST https://tender.su10.ru/api/v1/auth/logout` (empty body) | 204 | (empty) | always-204 idempotent |
| `GET https://tender.su10.ru/api/v1/me` (no token) | 401 | (problem+json) | middleware rejects un-authed |

### Backend env (live; on `root@45.80.128.254:/srv/sites/tender.su10.ru/server/.env.prod`)

Operator-supplied additions (no values printed):
```
AUTH_MODE=dual
APP_JWT_ISSUER=https://tender.su10.ru
APP_JWT_AUDIENCE=hubtender
APP_ACCESS_TOKEN_TTL_MINUTES=15
APP_REFRESH_TOKEN_TTL_DAYS=30
APP_JWT_PRIVATE_KEY_PATH=<operator-managed stable path>
```
`AUTH_MODE=dual` (NOT `app`) выбран сознательно: и app JWT, и Supabase JWT
принимаются. Это даёт окно для rollback без перезапуска BFF.

### nginx route

Operator added `location /.well-known/jwks.json` → BFF; previous conflicting
backup moved to `/root/nginx-backups/`. `nginx -t` clean, `systemctl reload nginx`.

### Build/release

- BFF image: `hubtender-api:prod` (docker build at deploy time, includes current `main`)
- service: `hubtender-bff.service` restarted via `systemctl restart`
- BFF listens on `127.0.0.1:3006`, nginx proxies `/api/*` and `/.well-known/jwks.json`

## Frontend cutover

### Build

- `npm run build:prod` (`vite build --mode production.yandex`)
- Release: `hubtender-web@74f399a`
- Sentry source maps uploaded
- Bundle has `VITE_AUTH_MODE="app"` inlined → `getAuthMode()` resolves to `'app'`

### Deploy

- Backup: `/srv/sites/tender.su10.ru/public.backup-20260523-164121` (auto by `deploy-server.sh`)
- `rsync -a --delete dist/ /srv/sites/tender.su10.ru/public/`
- `GET https://tender.su10.ru/`: 200, `Last-Modified: Sat, 23 May 2026 16:41:14 GMT`

### Frontend env (live; on `/opt/hubtender-build/.env.production.yandex`)

```
VITE_AUTH_MODE=app
VITE_API_URL=https://tender.su10.ru
VITE_API_MODE=go
VITE_API_REALTIME_ENABLED=true
VITE_API_*_ENABLED=true   # all 18 domains
VITE_SUPABASE_URL=https://ocauafggjrqvopxjihas.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon — public-by-design>
```
Supabase env preserved deliberately — SDK still bundled as fallback for the
transition period (Phase 6 spec).

## Browser smoke (operator-driven, production)

16/16 PASS:

| # | Check | Result |
|---|---|---|
| 1 | `/login` opens | ✅ |
| 2 | `POST /api/v1/auth/login` → 200 | ✅ |
| 3 | Supabase `/auth/v1/token` calls during login | **0** ✅ |
| 4 | `GET /api/v1/auth/me` → 200 | ✅ |
| 5 | `GET /api/v1/me` → 200 | ✅ |
| 6 | `GET /api/v1/me/permissions` → 200 | ✅ |
| 7 | `GET /api/v1/references/*` → 200 | ✅ |
| 8 | `GET /api/v1/tenders` → 200 | ✅ |
| 9 | BOQ/items page (API через `/api/v1`, без Supabase REST) | ✅ |
| 10 | WebSocket `wss://tender.su10.ru/api/v1/ws` connected | ✅ |
| 11 | Reload preserves session | ✅ |
| 12 | `POST /api/v1/auth/logout` → 204/200 | ✅ |
| 13 | `localStorage.hubtender_app_auth_*` cleared after logout | ✅ |
| 14 | Register / Forgot / Reset — controlled "временно недоступн{а,о}" | ✅ |
| 15 | Supabase business REST (`*.supabase.co/rest/v1/*`) | **0** ✅ |
| 16 | Supabase Auth in app login flow (`*.supabase.co/auth/*`) | **0** ✅ |

## Что осталось как было

- **Supabase SDK** (`@supabase/supabase-js`) — всё ещё в `package.json` и в bundle. Используется ТОЛЬКО как fallback в supabase-mode-ветках кода (deprecated, не достигаются runtime'ом).
- **Supabase Auth bridge** (anon-key, URL в env) — НЕ удалён: ничего не сломается, если временно понадобится откатить `VITE_AUTH_MODE` обратно в `supabase`.
- **app_auth DB tables** (`refresh_tokens`, `password_reset_tokens`, `auth_events`) живут на Yandex; cutover пишет туда (это «inevitable side effects» по плану 33/36 smoke).

## Что временно отключено для пользователей

| Flow | Поведение в app mode | UX |
|---|---|---|
| `/register` | controlled `<Result status="info">` | «Регистрация временно недоступна. Обратитесь к администратору.» |
| `/forgot-password` | controlled placeholder | «Сброс пароля временно недоступен. Обратитесь к администратору.» |
| `/reset-password` | controlled placeholder | то же |
| Смена пароля внутри SPA | endpoint'а нет | пока никак |
| Подтверждение email | n/a | n/a |

Storage для reset-токенов (`app_auth.password_reset_tokens`) уже создан, ждёт
HTTP handler'ов в следующей итерации.

## Влияние на текущих пользователей

- **Re-login required.** Старые Supabase access-tokens продолжат работать в
  `AUTH_MODE=dual` до их истечения (~1 час по дефолту Supabase JWT), но
  refresh их новый фронт делать не будет (фронт в `app` mode и refresh-
  путь идёт в Go BFF). Практический исход: при следующем заходе после
  истечения текущей сессии пользователь увидит редирект на `/login` и
  залогинится через Go BFF свежим bcrypt-сравнением.
- Никаких email-нотификаций не отправлено. Если важно — отдельный канал
  (Slack/email) уведомления.

## Rollback path (если что-то всплывёт в первые сутки)

Backend никуда не двигать (он в `dual`, принимает обе ветви). Достаточно
откатить фронт:

```bash
ssh root@45.80.128.254 'cd /srv/sites/tender.su10.ru && \
  rsync -a --delete public.backup-20260523-164121/ public/'
```

Это вернёт SPA в supabase-mode (предыдущий бандл без `VITE_AUTH_MODE=app`),
Supabase Auth снова станет рабочим login-путём. Бэкенд при этом продолжит
принимать оба issuer'а — никаких 401 у уже залогиненных в app-mode
пользователей не будет.

Полный откат (если нужно убрать app-mode и на backend'е):
```
# на сервере в /srv/sites/tender.su10.ru/server/.env.prod:
AUTH_MODE=supabase
# systemctl restart hubtender-bff.service
```
`app_auth.*` таблицы оставить — пригодятся для повторной попытки.

## Open issues / pre-existing P1 follow-up

**`GET /api/v1/tenders/{id}` returns 500** — обнаружено при пост-cutover
навигации в браузере на тендере `e8c3a228-0c46-4cd6-895f-a33790cd3e97`.

Это **НЕ регрессия Phase 6 auth cutover**:
- handler — `fiH.GetTenderByID` (Financial Indicators), не связан с auth
- зафиксировано в [36 doc](36_APP_AUTH_BACKEND_SMOKE_RESULT.md) ещё ДО cutover'а: на том же тендере `GET /api/v1/tenders/<id>/positions` возвращал 500 ("failed to list positions"), я тогда обошёл через `/positions/with-costs` (1181 позиций)
- JWT успешно проверяется (401 не возникает) → middleware OK → проблема в business handler

Диагноз и фикс — **отдельная задача**. Рекомендуемые шаги:
```bash
ssh root@45.80.128.254 'journalctl -u hubtender-bff.service -n 300 --no-pager' \
  | grep -E "tenders/e8c3a228|GetTenderByID|FIRepo|level\":\"error" \
  | tail -30
```
Скорее всего pgx-ошибка в одном из подзапросов FI-агрегации; нужно посмотреть
точный SQL и сравнить со схемой Yandex.

В рамках Phase 6 этот баг **не блокирует**: auth-флоу полностью функционален,
влияет только на конкретный путь UX (страница тендера через FI-aggregate).

## Next phase

- **P1: пофиксить `/api/v1/tenders/{id}` 500** (см. Open issues выше). Отдельная задача, отдельный PR.
- **Register endpoint** на BFF (`POST /api/v1/auth/register`) — портировать `services/user.go.Register` в auth-flow, поднять страницу из placeholder'а.
- **Forgot / reset password** handlers на BFF — storage (`app_auth.password_reset_tokens`) готов, нужен HTTP + email sender. Поднять Forgot/Reset страницы из placeholder'а.
- **Change password / change email** внутри SPA — после reset-flow.
- **`AUTH_MODE=app`** на backend (с `dual`) — после grace-window'a (≥ 1 час, лучше сутки), чтобы все Supabase JWT успели протухнуть.
- **Удаление Supabase Auth bridge**: drop `@supabase/supabase-js` зависимости, `src/lib/supabase/client.ts`, всё supabase-mode-ветки. CLAUDE.md "Бизнес-вызовы Supabase уже удалены" → закроется и auth-bridge.
- **Удаление `supabaseWithAudit.ts`** (deprecated; см. [35 doc](35_APP_AUTH_E2E_PRECHECK_FIX.md)) — заменить четыре call-site'а в `PositionItems/**` на типовые wrappers в `src/lib/api/boq.ts`.

## Related docs

- [29_APP_AUTH_SCHEMA_PLAN.md](29_APP_AUTH_SCHEMA_PLAN.md) — DB-схема plan
- [30_APP_AUTH_SCHEMA_APPLY_RESULT.md](30_APP_AUTH_SCHEMA_APPLY_RESULT.md) — apply
- [31_APP_AUTH_SCHEMA_VERIFY_RESULT.md](31_APP_AUTH_SCHEMA_VERIFY_RESULT.md) — verify
- [32_APP_AUTH_BACKEND_MVP_RESULT.md](32_APP_AUTH_BACKEND_MVP_RESULT.md) — backend MVP
- [33_APP_AUTH_BACKEND_SMOKE_RESULT.md](33_APP_AUTH_BACKEND_SMOKE_RESULT.md) — backend smoke
- [34_FRONTEND_APP_AUTH_MVP_RESULT.md](34_FRONTEND_APP_AUTH_MVP_RESULT.md) — frontend MVP
- [35_APP_AUTH_E2E_PRECHECK_FIX.md](35_APP_AUTH_E2E_PRECHECK_FIX.md) — supabaseWithAudit token-source fix
- [36_APP_AUTH_E2E_SMOKE_RESULT.md](36_APP_AUTH_E2E_SMOKE_RESULT.md) — E2E harness smoke
- [37_APP_AUTH_BROWSER_SMOKE_RESULT.md](37_APP_AUTH_BROWSER_SMOKE_RESULT.md) — local Playwright browser smoke
- **38 (this)** — production cutover
