# HUBTender RC1 — Environment Manifest

Commit `662f50b`. Полный runtime-справочник: [`docs/RUNTIME_ENV.md`](../RUNTIME_ENV.md). Здесь — release-аудит: обязательность, defaults, поведение при отсутствии, секретность. **Реальные значения секретов не приводятся.**

## Backend (Go BFF)

| Переменная | Обяз. | Default | Secret | Значения / формат | Prod-рекомендация | Поведение при отсутствии | Владелец |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | да | — | **ДА** | pgx DSN, prod: `sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem` | Yandex Managed PG DSN | startup fail (fatal) | владелец |
| `PORT` | нет | `3005` | нет | tcp port | `3005` (за nginx) | default | DevOps |
| `BIND_HOST` | нет | `0.0.0.0` | нет | ip | `0.0.0.0` в контейнере | default | DevOps |
| `CORS_ORIGINS` | да (prod) | dev-friendly | нет | csv origins | `https://tender.su10.ru` | dev-режим CORS | DevOps |
| `APP_JWT_ISSUER` | да | — | нет | public origin | `https://tender.su10.ru` | startup fail | владелец |
| `APP_JWT_AUDIENCE` | нет | — | нет | строка | `hubtender-web` | без aud-проверки | владелец |
| `APP_JWT_KEY_ID` | да | — | нет (в JWKS) | opaque | ротация вместе с ключом | startup fail | владелец |
| `APP_JWT_PRIVATE_KEY_PATH` / `_B64` | да (одна из) | — | **ДА** (компрометация = auth bypass) | PEM / base64 | mounted PEM, chmod 600 | startup fail | владелец |
| `APP_ACCESS_TOKEN_TTL_MINUTES` | нет | `15` | нет | int | `15` | default | владелец |
| `APP_REFRESH_TOKEN_TTL_DAYS` | нет | `30` | нет | int | `30` | default | владелец |
| `APP_ENV` | нет | `development` | нет | production/staging/development | `production` | dev-режим | DevOps |
| `APP_BASE_URL` | да (для recovery-писем) | — | нет | public origin | `https://tender.su10.ru` | reset-ссылки не собрать | владелец |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | нет | — | `SMTP_PASSWORD`,`SMTP_USER` — **ДА** | — | настроить для password-recovery | NoopMailer; `/forgot-password` → 503 | владелец |
| `LOG_LEVEL` | нет | `info` | нет | trace…error | `info` | default | DevOps |
| `DB_MAX_CONNS` / `DB_MIN_CONNS` / `DB_MAX_CONN_IDLE_TIME` | нет | `20`/`2`/`5m` | нет | int / duration | defaults | defaults | DevOps |
| `JWT_CLOCK_SKEW_SECONDS` | нет | `0` (strict) | нет | int | unset | strict | DevOps |
| `SENTRY_DSN/ENVIRONMENT/RELEASE` | нет | — | DSN — rate-limited public | — | задать | Sentry no-op | DevOps |

## Recovery (этап 2.4)

| Переменная | Обяз. | Default | Secret | Prod-рекомендация | При отсутствии |
|---|---|---|---|---|---|
| `RECALC_RECOVERY_ENABLED` | нет | **`true`** | нет | `true` (default) | recovery включён |
| `RECALC_RECOVERY_SCAN_INTERVAL` | нет | безопасный interval | нет | default | default |
| `RECALC_RECOVERY_CALCULATING_TIMEOUT` | нет | безопасный timeout | нет | default | default |
| `RECALC_RECOVERY_BATCH_SIZE` | нет | безопасный размер | нет | default | default |

## OpenRouter / AI (этапы 2.3–2.6)

| Переменная | Обяз. | Default | Secret | Prod-рекомендация | При отсутствии |
|---|---|---|---|---|---|
| `OPENROUTER_API_KEY` | **нет** | — | **ДА** | задать только при решении о пилоте | **приложение стартует**; admin-статус «ключ не настроен»; live-вызовы невозможны; suggest → детерминированный путь |
| `OPENROUTER_API_BASE` | нет | `https://openrouter.ai/api/v1` | нет | default; **не подменяется request-параметром** (жёстко из env, проверено `openRouterAdministrationSafety`-guard) | default |
| `OPENROUTER_LIVE_TEST` | нет | `false` | нет | `false`; `true` только для e2e/fake-server | live model-test отключён |
| `OPENROUTER_TEST_MODEL_ID` | нет | — | нет | не задавать (модель выбирается в admin UI) | — |
| `AI_NOMENCLATURE_ENABLED` | нет | `false` | нет | `false` до решения владельца | DisabledProvider |
| `AI_NOMENCLATURE_PROVIDER` / `AI_NOMENCLATURE_MODEL` | нет | disabled/— | нет | управляется через admin UI + БД | disabled |
| `AI_ROLLOUT_MAINTENANCE_ENABLED` | нет | **`true`** | нет | `true` | обслуживание квот/retention выключено |
| `AI_ROLLOUT_MAINTENANCE_SCAN_INTERVAL` | нет | безопасный interval | нет | default | default |
| `AI_NOMENCLATURE_EVAL_APPROVED_ALIASES` | нет | — | нет | только для offline-eval CLI | — |
| `READINESS_DATABASE_URL` | нет | — | **ДА** (DSN) | только для readiness-audit CLI | audit использует `DATABASE_URL` |

**Rollout mode хранится в БД** (`ai_feature_settings.rollout_mode`, seed `off`), env-переключателя general availability нет.

## Frontend (Vite, inline в бандл — только public)

| Переменная | Обяз. | Secret | Prod value |
|---|---|---|---|
| `VITE_API_URL` | да | нет | `https://tender.su10.ru` |
| `VITE_API_MODE` | да | нет | `go` |
| `VITE_API_REALTIME_ENABLED` + `VITE_API_<DOMAIN>_ENABLED` ×18 | да | нет | `true` |
| `VITE_SENTRY_DSN/ENVIRONMENT/RELEASE` | нет | rate-limited public key | заданы |

PWA-файлы генерирует `vite-plugin-pwa` при build; отдельных env нет. Шаблоны: `.env.example`, `.env.production.yandex.example` (только placeholder'ы).

## E2E / rehearsal (не production)

`E2E_BASE_URL`, `E2E_PG_PORT/WEB_PORT/API_PORT/OPENROUTER_PORT`, `E2E_PG_CONTAINER`, `E2E_OPENROUTER_STATS`, `REHEARSAL_BASE_REF`, `REHEARSAL_SKIP_FRONTEND` — используются только disposable-скриптами `scripts/readiness/*`; production credentials этими скриптами не читаются (guard внутри скриптов).

## Обязательные release-проверки (§6) — результат

| Проверка | Результат |
|---|---|
| `OPENROUTER_API_KEY` отсутствует во frontend env / бандле | PASS — нет `VITE_OPENROUTER*`; bundle-скан в browser-smoke гейте ищет значение ключа в `dist/assets` |
| Rollout default = `off` | PASS — seed миграции + CHECK-констрейнт; E2E `zz-ai-rollout.spec.ts` подтверждает `off` после smoke |
| AI key отсутствует → приложение запускается | PASS — rehearsal-стек стартует без реального ключа |
| Recovery default включён | PASS — `RECALC_RECOVERY_ENABLED` default `true` |
| Budget/quotas — безопасные defaults | PASS — `daily_request_limit=20`, `daily_row_limit=400`, `request_max_reserved_cost=0.05`, CHECK-констрейнты диапазонов |
| Production base URL не подменяется request-параметром | PASS — `OPENROUTER_API_BASE` только из env (guard `openRouterAdministrationSafety`) |
| `.env.example` без секретов | PASS — только placeholder'ы; файл в этом релизе не изменялся |
