# 33 — App-Auth Backend Smoke Result

> Phase 6 backend MVP smoked end-to-end against the **live Yandex Managed PostgreSQL
> runtime** in `AUTH_MODE=dual`. All eight scenarios green. No frontend, deploy,
> or production env changes.

## Timestamp

UTC: 2026-05-23T13:14:00Z (smoke run)

## Launch method

Локально, headless. Существующий dev-инстанс BFF на `:3005` (старый билд без
app-auth) **не трогался** — мой smoke-инстанс поднялся на `:3006`, чтобы не
дисраптить чужую сессию.

- **Binary**: `backend/hubtender-bff.exe` пересобран из `commit 12f789a` через
  `go build ./cmd/server` (Go 1.23).
- **Env**: `.certs/bff-launch.env` (gitignored под `.certs/`) — собран
  скриптом [.certs/smoke/compose-env.mjs](../../.certs/smoke/compose-env.mjs) (не коммитится).
  Значения single-quoted, чтобы `&` / `?` в DSN не интерпретировались bash.
- **DSN**: `DATABASE_URL` = Yandex `YANDEX_DATABASE_URL` (из
  `scripts/app-auth/.env.app-auth`). Хост / порт / БД / `sslmode` —
  стандартные для runtime Yandex Managed PG (не печатаются).
- **Ephemeral RSA test key**: `.certs/test-app-jwt.pem` сгенерирован
  `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`. **Не
  коммитится** (`.certs/` теперь в `.gitignore`). Файл оставлен на диске для
  повторных прогонов; удалить можно `rm .certs/test-app-jwt.pem` после смены ключа.
- **Auth mode**: `AUTH_MODE=dual`.
- **Process exit**: BFF остановлен через `taskkill /F /PID <pid>` после прохода
  smoke. На :3006 ничего не висит.

Расхождения с вашей спекой (объяснено):

| Поле | Спека | Реально | Причина |
|---|---|---|---|
| `PORT` | 3005 | **3006** | На :3005 чужой dev-инстанс — не убивал |
| `APP_JWT_ISSUER` | `http://localhost:3005` | `http://localhost:3006` | Зеркалит реальный listening port |
| smoke email/password | `MIGRATION_SMOKE_*` | **`DUAL_RUN_*`** | `MIGRATION_SMOKE_*` живёт только в `.old-to-prod-export` (cutover-периодные), нет в текущем `.env`. `DUAL_RUN_*` — текущие smoke-credentials |

## Health result

```
GET /health           → 200 {"status":"ok"}
GET /health/db        → 200 {"status":"ok"}
```

DB connectivity to Yandex подтверждён (real ping на `current_database() = 'HubTender'`).

## Login result (без печати токенов)

```
POST /api/v1/auth/login  → 200
user.id            <uuid redacted>
user.email         o***@gmail.com
user.full_name     <redacted>
user.role_code     developer
user.access_status approved
user.access_enabled true
token_type         Bearer
expires_in         900            # 15 min × 60 = APP_ACCESS_TOKEN_TTL_MINUTES
access_token       <RS256 JWT, redacted>
refresh_token      <opaque, redacted>
```

Bcrypt round-trip против `auth.users.encrypted_password` (импортирован
байт-в-байт из PROD на 2026-05-18) сработал — фронт сможет залогиниться
старым паролем без reset.

## /auth/me result

```
GET /api/v1/auth/me      (Authorization: Bearer <app access token>) → 200
id, email, full_name, role_code, access_status — все совпадают с login response
```

## /api/v1/me result (existing protected API c app JWT)

```
GET /api/v1/me                   → 200  (legacy /me handler принял app JWT)
GET /api/v1/me/permissions       → 200
GET /api/v1/references/roles     → 200  (data_count = 9 ролей)
GET /api/v1/tenders?limit=5      → 200  (data_count = 5 тендеров)
```

Подтверждено: middleware dual-mode корректно прокидывает `AuthUser` для app JWT,
и legacy-хендлеры не требуют переписывания.

## Refresh result

```
POST /api/v1/auth/refresh  → 200
  # rotated pair returned (both tokens redacted; new != old).
  # access_token TTL = 900s, refresh_token TTL = 30d.

POST /api/v1/auth/refresh (replay OLD token) → 401 "invalid or expired refresh token"
```

В БД — `refresh_rotated` event с `family_id`, а replay → `refresh_reuse_detected`
event с тем же `family_id`. Вся семья отозвана.

## Logout result

```
POST /api/v1/auth/logout (current refresh) → 204 No Content
POST /api/v1/auth/refresh (logged-out token) → 401 "invalid or expired refresh token"
```

В БД — `logout` event + последующий refresh заработал `refresh_reuse_detected`
(потому что после logout токен помечен `revoked_at`, и любая попытка
интерпретируется как реюз). Защита от race работает.

## Dual-mode Supabase JWT result

Логин через Supabase Auth REST напрямую (без `@supabase/supabase-js` зависимости):

```
POST {SUPABASE}/auth/v1/token?grant_type=password → 200
  user.id matches app-auth login (same account)
  access_token, refresh_token returned (redacted)

GET /api/v1/me           (Supabase JWT)  → 200
GET /api/v1/references/roles (Supabase JWT) → 200
```

✅ В `AUTH_MODE=dual` middleware принимает оба issuer'а (Supabase JWKS и
local app JWT). Маршрутизация по `iss` claim без сетевых хождений на каждый
request.

## JWKS result

```
GET /.well-known/jwks.json → 200
keys count       = 1
private fields   = []   # d, p, q, dp, dq, qi — ни одного утечки приватных частей
key kty=RSA      alg=RS256
kid              = <RFC 7638 thumbprint, derived from public key>
```

## DB-side verification (app_auth.auth_events tail)

| timestamp UTC | event | metadata |
|---|---|---|
| 13:12:03Z | `login_failed` | `{"reason":"password_mismatch"}` |
| 13:13:42Z | `login_success` | `{}` |
| 13:14:02Z | `login_success` | `{}` |
| 13:14:36Z | `refresh_rotated` | `{"family_id":"<uuid>"}` |
| 13:14:37Z | `refresh_reuse_detected` | `{"family_id":"<uuid>"}` |
| 13:14:37Z | `logout` | `{"family_id":"<uuid>"}` |
| 13:14:37Z | `refresh_reuse_detected` | `{"family_id":"<uuid>"}` |

`app_auth.refresh_tokens` для тестового user_id за окно: **1 active, 2 revoked, 2 families**
(login → rotate → reuse-revoke; second login = new family).

## Final status

**APP_AUTH_BACKEND_SMOKE_OK**

## Blockers / warnings (resolved before final status)

| # | Blocker | Resolution |
|---|---|---|
| 1 | Старый BFF на :3005 без app-auth endpoints | Запустил smoke-инстанс на :3006, исходный не трогал |
| 2 | bash `source` ломал DSN из-за `&` в querystring (BFF цеплялся к дефолтной БД, `app_auth.auth_events` "does not exist") | Переписал env-файл с single-quoted values через [.certs/smoke/compose-env.mjs](../../.certs/smoke/compose-env.mjs) |
| 3 | `DUAL_RUN_PASSWORD` в `.env` был устаревший — login failed (401, `password_mismatch` event) и на Yandex, и на Supabase | Пользователь обновил `DUAL_RUN_PASSWORD` вручную; повторный login → 200 |
| 4 | `.certs/` НЕ был в `.gitignore` — риск закоммитить test private key | Добавил строку `.certs/` в `.gitignore` (commit отдельно) |

## Open / non-blocker notes

- ⚠️ Smoke instance работал **параллельно** с прод-стилевым BFF на :3005 — обе сессии
  читают/пишут одну Yandex БД одновременно. Никаких lock-проблем не было; репликации
  / триггеров эта нагрузка тоже не дёрнула.
- ℹ️ APP_JWT_KEY_ID не задавался — issuer берёт kid из RFC 7638 thumbprint
  публичного ключа (значение в `.certs/bff.log`, не публикуем). На прод
  можно задать кастомный, но это эстетика, не функциональность.
- ℹ️ Реальный refresh-token TTL = 30 дней (по env); рантайм-роста таблицы
  `refresh_tokens` под существующей нагрузкой не оценивал — отдельная задача.
- ℹ️ `app_auth.password_reset_tokens` присутствует в схеме, но endpoints
  `forgot-password` / `reset-password` пока не реализованы (вынесено в Phase 6 followup).

## Что НЕ сделано (по запрету в промте)

- ❌ frontend не трогался
- ❌ деплой не выполнялся
- ❌ production env не менялся
- ❌ Supabase Auth bridge не удалялся (только проверили совместимость в dual mode)
- ❌ import / clean / repair не запускались
- ❌ push не выполнялся

## Артефакты (gitignored)

- `.certs/test-app-jwt.pem` — ephemeral RSA private key
- `.certs/bff-launch.env` — composed launch env
- `.certs/bff.log` — server stdout/stderr
- `.certs/smoke/app.json`, `.certs/smoke/app.before-refresh.json`, `.certs/smoke/supabase.json`
  — captured token payloads (содержат plaintext refresh tokens — НЕ коммитятся)
- `.certs/smoke/compose-env.mjs`, `.certs/smoke/smoke.mjs` — runner scripts

Очистка после прогона (опционально):
```powershell
Remove-Item -Recurse -Force .certs\smoke
Remove-Item .certs\bff-launch.env .certs\bff.log .certs\test-app-jwt.pem
```
