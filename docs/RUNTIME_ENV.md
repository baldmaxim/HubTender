# Runtime environment

Какие переменные нужны для запуска и где они живут. Реальные значения
**не в git** — только шаблоны `.env.example`.

## Frontend (Vite)

Бандл собирается из `.env.production.yandex` через
`npx vite build --mode production.yandex`.

| Переменная | Значение (prod) | Где |
|---|---|---|
| `VITE_API_URL` | `https://tender.su10.ru` | inline в bundle |
| `VITE_API_MODE` | `go` | inline (Vite constant-fold) |
| `VITE_API_REALTIME_ENABLED` | `true` | inline |
| `VITE_API_<DOMAIN>_ENABLED` × 18 | все `true` | inline |
| `VITE_SENTRY_DSN` / `VITE_SENTRY_ENVIRONMENT` / `VITE_SENTRY_RELEASE` | Sentry frontend error tracking | inline |

**Никаких VITE_*-секретов.** Vite встраивает `VITE_*` в клиентский бандл —
сервисные ключи там нельзя.

Supabase runtime удалён целиком — нет ни `supabase.auth.*`, ни
`supabase.from()`, ни `@supabase/supabase-js` в bundle. Соответствующие
env-переменные (`VITE_AUTH_MODE`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`) удалены (см.
`docs/yandex-migration/43_SUPABASE_AUTH_REMOVAL_RESULT.md`).

Шаблон: `.env.production.yandex.example` или `.env.example`.

## Backend (Go BFF)

Production env-файл живёт на prod-сервере: `/srv/sites/tender.su10.ru/server/.env.prod`
(`chmod 600`, **вне git**). Local dev — `.env` в корне репо (тоже не в git).

| Переменная | Назначение | Production value (masked) |
|---|---|---|
| `DATABASE_URL` | DSN Yandex Managed PG | `postgres://…@<cluster>.mdb.yandexcloud.net:6432/HubTender?sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem` |
| `APP_JWT_ISSUER` | `iss`-claim, ставится на access tokens; равен публичному origin | `https://tender.su10.ru` |
| `APP_JWT_AUDIENCE` | optional `aud`-claim | `hubtender-web` |
| `APP_JWT_KEY_ID` | `kid` в JWKS | opaque string (rotate together with key) |
| `APP_JWT_PRIVATE_KEY_PATH` или `_B64` | RSA private key для подписи RS256 JWT | mounted PEM file / base64 |
| `APP_ACCESS_TOKEN_TTL_MINUTES` | TTL access-token | `15` |
| `APP_REFRESH_TOKEN_TTL_DAYS` | TTL refresh-token | `30` |
| `APP_ENV` | `production` / `staging` / `development` | `production` |
| `APP_BASE_URL` | публичный origin для password-reset ссылок | `https://tender.su10.ru` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | password-recovery mailer; пустой `SMTP_HOST` → NoopMailer | currently unset → /forgot-password возвращает 503 `email_provider_not_configured` в проде |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | `https://tender.su10.ru` |
| `PORT` | Bind port (внутри контейнера) | `3005` (наружу через nginx → `127.0.0.1:3006`) |
| `BIND_HOST` | Bind address | `0.0.0.0` в контейнере, `127.0.0.1` извне |
| `LOG_LEVEL` | trace/debug/info/warn/error | `info` |
| `DB_MAX_CONNS` | pgxpool MaxConns | `20` |
| `DB_MIN_CONNS` | pgxpool MinConns | `2` |
| `DB_MAX_CONN_IDLE_TIME` | Go duration string | `5m` |
| `JWT_CLOCK_SKEW_SECONDS` | leeway для exp/iat | unset (`0`, strict). Включать только для dev/Windows |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | error tracking; пустой DSN → no-op | set in prod |

### TLS root CA для Yandex

`/certs/yandex-ca.pem` — read-only mount в контейнер `hubtender-bff`.
Скачивается с `https://storage.yandexcloud.net/cloud-certs/CA.pem`.
Путь жёстко прописан в `DATABASE_URL` через query-param `sslrootcert=`.

## Что НЕ нужно для runtime (удалено)

| Переменная | Когда использовалась | Статус |
|---|---|---|
| `AUTH_MODE` (backend) | dual-issuer cutover (Supabase + app JWT) | удалена; backend принимает только app JWT |
| `SUPABASE_JWKS_URL` | JWKS для верификации Supabase JWT | удалена; backend больше не верифицирует Supabase JWT |
| `SUPABASE_JWT_ISSUER` | `iss`-проверка Supabase JWT | удалена |
| `SUPABASE_JWT_SECRET` | HS256-вариант (никогда не активировался в проде) | удалена |
| `VITE_AUTH_MODE` (frontend) | переключатель supabase/app для UI | удалена; UI всегда использует app-auth |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (frontend) | конфиг supabase-js SDK | удалены вместе с SDK (см. doc 43) |
| `SUPABASE_SERVICE_ROLE_KEY` | dev-скрипты, миграционные ETL | переехала в `archive/migrations/` |

Миграционные переменные (`OLD_*`, `DUAL_RUN_*`, `ALLOW_*` и пр.) — см.
`archive/migrations/2026-05-db-cutover/`.

## Local development

```bash
# Frontend
npm install
npm run dev                    # http://localhost:5185

# Backend (через Docker)
docker build -t hubtender-api:local ./backend
docker run --rm --env-file .env -p 3005:3005 hubtender-api:local

# Backend (native Go, требует Go 1.23+)
cd backend && go build -o /tmp/hubtender ./cmd/server
DATABASE_URL=... APP_JWT_ISSUER=... APP_JWT_PRIVATE_KEY_PATH=... CORS_ORIGINS=... /tmp/hubtender
```

## Smoke harness

```bash
npm run smoke
# scripts/smoke/go-bff.mjs — health, 401 unauth, JWT login,
# /api/v1/me, references, tenders. Использует DUAL_RUN_EMAIL/PASSWORD из
# .env для login probe.
```

Smoke выполняется против `VITE_API_URL` (по умолчанию
`http://localhost:3005`). Для проверки против prod —
`VITE_API_URL=https://tender.su10.ru npm run smoke`.

## Что под секретом, что нет

| Категория | Можно ли в логи/git | Пример |
|---|---|---|
| `DATABASE_URL` (с паролем) | ❌ никогда | prod Yandex DSN |
| `APP_JWT_PRIVATE_KEY_*` | ❌ никогда — компрометация = полный auth bypass | mounted PEM или base64 в `.env.prod` |
| `APP_JWT_ISSUER` / `APP_JWT_AUDIENCE` / `APP_JWT_KEY_ID` | ✅ public (kid появляется в JWKS) | `https://tender.su10.ru` / `hubtender-web` |
| `SMTP_PASSWORD` / `SMTP_USER` | ❌ никогда | provider creds |
| Yandex cluster ID (`rc1d-…` / `c-…`) | ⚠ внутренний идентификатор, не credential | в docs допустимо как reference |
| Yandex CA PEM | ✅ public (downloads from Yandex docs) | `/certs/yandex-ca.pem` |
