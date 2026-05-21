# 32 — App-Auth Backend MVP

> Phase 6 backend MVP: Go BFF can now issue its own access + refresh tokens,
> validate them, and serve a public JWKS. Supabase Auth bridge stays
> functional (dual-mode middleware) — the frontend cutover is a separate
> step.

## Endpoints implemented

| Method | Path                          | Auth         | Body / Response |
|--------|-------------------------------|--------------|-----------------|
| POST   | `/api/v1/auth/login`          | public       | `{email,password}` → `AuthResult` (access + refresh + user) |
| POST   | `/api/v1/auth/refresh`        | public       | `{refresh_token}` → `AuthResult` (rotated pair) |
| POST   | `/api/v1/auth/logout`         | public       | `{refresh_token?}` → 204 No Content |
| GET    | `/api/v1/auth/me`             | app JWT      | → `UserPayload` (same shape as login.user) |
| GET    | `/.well-known/jwks.json`      | public       | → JWKS (RS256, kid = RFC 7638 thumbprint) |

Все маршруты зарегистрированы в [backend/cmd/server/main.go](../../backend/cmd/server/main.go).
Реализация — в [backend/internal/auth/handlers.go](../../backend/internal/auth/handlers.go).

`register` / `forgot-password` / `reset-password` — **не реализованы** в этом
промте (вынесены в "remaining work"). DB-слой для reset-токенов уже на месте
(`app_auth.password_reset_tokens`), но HTTP-эндпоинты не подняты.

## Config env (новые / изменённые)

```env
# Required (always)
DATABASE_URL=...
CORS_ORIGINS=...

# Auth-mode selector — supabase | dual | app (default: supabase)
AUTH_MODE=supabase

# Required when AUTH_MODE=supabase or dual
SUPABASE_JWKS_URL=
SUPABASE_JWT_ISSUER=

# Required when AUTH_MODE=app or dual
APP_JWT_ISSUER=https://tender.su10.ru/auth/v1
APP_JWT_AUDIENCE=tenderhub-frontend       # optional
APP_JWT_KEY_ID=                           # informational; kid is auto-derived
APP_JWT_PRIVATE_KEY_PATH=/secrets/app-jwt.pem
APP_JWT_PRIVATE_KEY_B64=                   # alternative to PATH; base64-encoded PEM
APP_ACCESS_TOKEN_TTL_MINUTES=15
APP_REFRESH_TOKEN_TTL_DAYS=30
```

Контракт валидирован в [backend/internal/config/config.go](../../backend/internal/config/config.go) (`Load()` отказывается стартовать с неполной конфигурацией под выбранный режим).

## Auth modes

| Mode       | Supabase JWT | App JWT | Когда использовать |
|------------|--------------|---------|-------------------|
| `supabase` | ✅ accept    | ❌ reject | Текущий runtime (legacy) |
| `dual`     | ✅ accept    | ✅ accept | Cutover window — фронт постепенно переключается на app-issuer |
| `app`      | ❌ reject    | ✅ accept | Конечное состояние Phase 6 |

Routing-логика — issuer-claim инспектируется без проверки подписи
(`jwt.NewParser().ParseUnverified`), затем выбирается верификатор по
`iss`. Реализация — [backend/internal/middleware/auth.go](../../backend/internal/middleware/auth.go) (`VerifyToken`, `JWTAuth`).

WS-handler ([backend/internal/handlers/ws.go](../../backend/internal/handlers/ws.go)) переехал на ту же `VerifyConfig`, так что `?token=` в WebSocket-URL теперь тоже dual-mode.

## Storage strategy

| Что хранится | Где | Формат |
|---|---|---|
| Password hashes | `auth.users.encrypted_password` | bcrypt (`$2a$10$…`), AS-IS из PROD Supabase. **Не rehash'им, не логируем.** |
| Refresh tokens | `app_auth.refresh_tokens.token_hash` | **SHA-256 hex** от plaintext-токена. Plaintext НЕ хранится. |
| Refresh rotation | same row + `replaced_by`, `revoked_at` | atomic в `pgx.Tx` через `Repository.RotateRefreshToken`. |
| Reset tokens | `app_auth.password_reset_tokens.token_hash` | SHA-256 hex. **Endpoints не подключены в этом промте**, но storage готов. |
| Audit | `app_auth.auth_events` | events: `login_success`, `login_failed`, `refresh_rotated`, `refresh_reuse_detected`, `logout` |

Reuse-detection: если повторно предъявить уже rotated refresh-токен, сервис
помечает `RevokedAt is not null`, лог пишет `refresh_reuse_detected`, и **вся
`token_family_id` отзывается** — пользователь должен заново залогиниться
свежей семьей.

## Tests result

`cd backend && go test ./internal/auth ./internal/middleware ./internal/handlers ./internal/repository`

```
ok  	github.com/su10/hubtender/backend/internal/auth	7.018s
ok  	github.com/su10/hubtender/backend/internal/middleware	2.580s
?   	github.com/su10/hubtender/backend/internal/handlers	[no test files]
?   	github.com/su10/hubtender/backend/internal/repository	[no test files]
```

Покрытие:

- **password**: round-trip, Supabase `$2a$10$`-compat prefix, empty rejection (`password_test.go` — pre-existing, не трогали).
- **issuer**: RS256 round-trip, expired-fails, wrong-iss-fails (`issuer_test.go` — pre-existing).
- **refresh_tokens** (новый): SHA-256 detereministic + diverging + hex64; UUIDv4 шаблон + uniqueness 64 итераций.
- **service** (новый): Login OK, wrong password, unknown email, empty hash, blocked by status / blocked by `access_enabled=false`, Refresh rotates + family preserved + old revoked, Refresh reuse revokes family, Refresh unknown / expired, Logout идемпотентен (4 кейса), Me OK / missing.
- **handlers** (новый): smoke — Login 200 / 401 / 403, Refresh 200 / 401, Logout always 204, JWKS публикует RS256 key с kid/n/e.
- **middleware** (новый): `ParseAuthMode` нормализация (incl. trimming/casing), VerifyToken app-OK / dual-OK / supabase-rejects-app / expired / wrong-iss / unknown-iss.

Полный `go test ./...`: всё зелёное, **кроме** `internal/calc/markup_test.go` — 3 теста (TestCalculateMarkupResult_MarkupAddOneFormat / StepReferencesBase / BaseCostOverride). Это **pre-existing float/domain issue в legacy calc-пакете**, не зависит от Phase 6 (мы внутри `internal/calc/` ничего не меняли). Отмечено как known.

## Build result

```
cd backend && go build ./cmd/server     # → backend/hubtender-bff.exe (20 MB)
```

`gofmt -l` clean. `npm run typecheck` clean (TS-код не менялся).

## Storage / Yandex-side preconditions

DB-слой уже применён (см. [30_APP_AUTH_SCHEMA_APPLY_RESULT.md](30_APP_AUTH_SCHEMA_APPLY_RESULT.md) +
[31_APP_AUTH_SCHEMA_VERIFY_RESULT.md](31_APP_AUTH_SCHEMA_VERIFY_RESULT.md)):

- `app_auth` schema exists
- `app_auth.refresh_tokens`, `app_auth.password_reset_tokens`, `app_auth.auth_events` готовы
- `auth.users.encrypted_password` текст с bcrypt-хэшами доступен

Этому промту достаточно — никаких новых миграций не нужно.

## Что НЕ сделано в этом промте

- ❌ Frontend app-auth client (отдельный шаг — переключение `src/contexts/AuthContext.tsx` на новые endpoints)
- ❌ `POST /api/v1/auth/register` (новый юзер; пока используется legacy `POST /api/v1/users/register`)
- ❌ `POST /api/v1/auth/forgot-password` + `POST /api/v1/auth/reset-password` (storage готов, handlers нет)
- ❌ Production app-auth cutover (`AUTH_MODE=dual` → `AUTH_MODE=app` после прохода frontend cutover)
- ❌ Удаление Supabase Auth bridge (`@supabase/supabase-js` зависимость + frontend AuthContext)
- ❌ Production env (не трогали, не деплоили)
- ❌ Push в remote

## Remaining work (короткий roadmap)

1. **Frontend app-auth client** — `src/lib/api/auth.ts` + переключение `AuthContext` с `supabase.auth.signInWithPassword` на новые endpoints. Дуальная схема: пока `AUTH_MODE=supabase`, фронт ничего не меняет; при `dual` фронт может выбирать; при `app` — обязательно через Go.
2. **`POST /api/v1/auth/register`** — портировать `services/user.go.Register` в app-auth (требует email-подтверждение flow, опционально).
3. **`forgot-password` / `reset-password`** — handler + email-отправитель + использование `app_auth.password_reset_tokens` (storage уже на месте).
4. **Прод-конфиг** — сгенерировать RSA 4096-бит ключ, положить в secret store, выставить `APP_JWT_PRIVATE_KEY_PATH`, переключить `AUTH_MODE=dual` в проде.
5. **Cutover** — после миграции фронта на app-issuer, перевести `AUTH_MODE=app`, выждать пока Supabase access-tokens протухнут, удалить Supabase Auth dependency + bridge.

## Blockers / warnings

- ⚠️ Реальная нагрузочная проверка к Yandex БД не запускалась — login / refresh не дёргали из бегущего сервера. Тесты используют fake-repo. Это сознательное MVP-решение: ход в реальную БД появится при frontend smoke против `AUTH_MODE=dual` стенда.
- ⚠️ `internal/calc/markup_test.go` падает (3 кейса) — known float/domain issue, не наш.
- ⚠️ Скрипты `scripts/app-auth/00_*.mjs` / `01_*.mjs` уже патчили в предыдущем коммите `a186a15` — никаких изменений в этом промте; они продолжают работать.

## Final status

**APP_AUTH_BACKEND_MVP_OK**
