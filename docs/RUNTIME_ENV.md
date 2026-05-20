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
| `VITE_SUPABASE_URL` | `https://ocauafggjrqvopxjihas.supabase.co` | inline (public) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon `eyJ***` (public by design) | inline |

**Никаких VITE_*-секретов.** Vite встраивает `VITE_*` в клиентский бандл —
сервисные ключи там нельзя.

Шаблон: `.env.production.yandex.example` (если есть) или `.env.example`.

## Backend (Go BFF)

Production env-файл живёт на prod-сервере: `/etc/hubtender/.env.prod`
(`chmod 600`, **вне git**). Local dev — `.env` в корне репо (тоже не в git).

| Переменная | Назначение | Production value (masked) |
|---|---|---|
| `DATABASE_URL` | DSN Yandex Managed PG | `postgres://…@rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net:6432/HubTender?sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem` |
| `SUPABASE_JWKS_URL` | URL JWKS для верификации JWT | `https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | Ожидаемый `iss`-claim в JWT | `https://ocauafggjrqvopxjihas.supabase.co/auth/v1` |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | `https://tender.su10.ru` |
| `PORT` | Bind port (внутри контейнера) | `3005` (наружу через nginx → `127.0.0.1:3006`) |
| `BIND_HOST` | Bind address | `0.0.0.0` в контейнере, `127.0.0.1` извне |
| `LOG_LEVEL` | trace/debug/info/warn/error | `info` |
| `DB_MAX_CONNS` | pgxpool MaxConns | `20` |
| `DB_MIN_CONNS` | pgxpool MinConns | `2` |
| `DB_MAX_CONN_IDLE_TIME` | Go duration string | `5m` |
| `JWT_CLOCK_SKEW_SECONDS` | leeway для exp/iat | unset (`0`, strict). Включать только для dev/Windows |

### TLS root CA для Yandex

`/certs/yandex-ca.pem` — read-only mount в контейнер `hubtender-bff`.
Скачивается с `https://storage.yandexcloud.net/cloud-certs/CA.pem`.
Путь жёстко прописан в `DATABASE_URL` через query-param `sslrootcert=`.

## Что НЕ нужно для runtime

Эти переменные использовались только для миграции (архивированы в
`archive/migrations/2026-05-db-cutover/`):

- `OLD_SUPABASE_DB_URL` — DSN старого Supabase (`wkywhjljrhewfpedbjzx`)
- `OLD_PROD_DATABASE_URL` — то же самое, alias
- `NEW_PREPROD_DATABASE_URL` — DSN PROD Supabase pre-cutover, alias к
  `PROD_SUPABASE_DB_URL`
- `PROD_SUPABASE_DB_URL` — DSN PROD Supabase (теперь rollback reference)
- `YANDEX_SSL_ROOT_CERT` — путь к Yandex CA для тулчейн-скриптов
- `MIGRATION_SMOKE_EMAIL` / `MIGRATION_SMOKE_PASSWORD` — креды для smoke
  при миграции
- `DUAL_RUN_EMAIL` / `DUAL_RUN_PASSWORD` — креды для dual-run сверки
- `ALLOW_*` env-флаги (`ALLOW_AUTH_IMPORT`, `ALLOW_CLEAN_YANDEX`, …) —
  явные approval gates миграционных скриптов

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
DATABASE_URL=... SUPABASE_JWKS_URL=... /tmp/hubtender
```

## Smoke harness

```bash
npm run smoke
# scripts/smoke/go-bff.mjs — health, 401 unauth, JWT login,
# /api/v1/me, references, tenders. Использует VITE_SUPABASE_URL +
# VITE_SUPABASE_PUBLISHABLE_KEY + DUAL_RUN_EMAIL/PASSWORD из .env
```

Smoke выполняется против `VITE_API_URL` (по умолчанию
`http://localhost:3005`). Для проверки против prod —
`VITE_API_URL=https://tender.su10.ru npm run smoke`.

## Что под секретом, что нет

| Категория | Можно ли в логи/git | Пример |
|---|---|---|
| Supabase **anon** key | ✅ public по дизайну (в bundle) | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Supabase **service-role** key | ❌ никогда | `SUPABASE_SERVICE_ROLE_KEY` |
| `DATABASE_URL` (с паролем) | ❌ никогда | prod Yandex DSN |
| JWKS URL, JWT issuer | ✅ public | `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` |
| Yandex cluster ID (`rc1d-…`) | ⚠ внутренний идентификатор, но не credential | в docs допустимо как reference |
| Supabase project ref | ✅ public | `ocauafggjrqvopxjihas` |
| Yandex CA PEM | ✅ public (downloads from Yandex docs) | `/certs/yandex-ca.pem` |
