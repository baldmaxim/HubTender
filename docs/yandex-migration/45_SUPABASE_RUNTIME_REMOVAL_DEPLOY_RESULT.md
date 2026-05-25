# 45 — Supabase Runtime Removal Deploy Result

> Production deploy результата [43 — Supabase Runtime Removal](43_SUPABASE_AUTH_REMOVAL_RESULT.md).
> Подтверждает, что bundle и backend на проде больше не содержат
> Supabase runtime ни в каком виде.

## Final status

**SUPABASE_RUNTIME_REMOVAL_DEPLOY_OK** — release `40fd7c4` задеплоен на
`https://tender.su10.ru` 2026-05-25. Backend startup-лог показывает
ожидаемые значения (`env=production`, `release=hubtender-api@40fd7c4`,
`mailer_configured=false`, `app_env=production`,
`app_base_url=https://tender.su10.ru`, kid не изменился). Frontend
bundle обновлён (`index-AznL5X1i.js`), `vendor-supabase-*.js` chunk
отсутствует. Все public probes возвращают ожидаемые HTTP-статусы.
Browser smoke (operator-confirmed) подтверждает 0 запросов на
`*.supabase.co/*` в Network panel за всю user-сессию, все business
ручки 200, logout очищает localStorage. **Supabase project физически
не удалён** — сохранён для schema-tooling и опционального rollback.

## Deploy facts

| Item | Value |
|---|---|
| Release | `40fd7c4` (commit «chore: remove supabase runtime») |
| Backend image | `hubtender-api:prod` (rebuilt; Go 1.23 / distroless static) |
| Backend startup | `2026-05-25T14:09:56Z`, server listening on `:3005` |
| Frontend backup | `/srv/sites/tender.su10.ru/backups/public/public.backup-20260525-141109` |
| Frontend release | `hubtender-web@40fd7c4` (Sentry sourcemaps uploaded) |
| BFF env file | `/srv/sites/tender.su10.ru/server/.env.prod` (patched `SENTRY_RELEASE=hubtender-api@40fd7c4`) |
| Build env file | `/opt/hubtender-build/.env.production.yandex` |

### Backend startup log (post-restart)

```
sentry initialised             env=production release=hubtender-api@40fd7c4
database pool connected
listener connection opened
connected; listening on channel 'rowchange'  component=listener
password-recovery flow configured            mailer_configured=false
                                             app_env=production
                                             app_base_url=https://tender.su10.ru
app JWT issuer ready                         kid=xDItcfIj5Kjn_UU9uYOcVl93afQYpNDiLlQCE1EAeag
                                             iss=https://tender.su10.ru
server listening                             port=3005
```

`kid` совпадает с ротированным ключом из прошлого деплоя — ключ не
менялся; новый release не требовал rotation.

### Loopback health (deploy script self-check)

```
GET http://127.0.0.1:3006/health      → {"status":"ok"}
GET http://127.0.0.1:3006/health/db   → {"status":"ok"}
```

## Public probes (harness-side от tender.su10.ru)

| Probe | Expected | Actual |
|---|---|---|
| `GET /.well-known/jwks.json` | 200, kid `xDItcfIj5Kjn_…` | ✅ `{"keys":[{"kty":"RSA","alg":"RS256","kid":"xDItcfIj5Kjn_UU9uYOcVl93afQYpNDiLlQCE1EAeag",...}]}` |
| `POST /api/v1/auth/login` `{}` | 401 invalid credentials | ✅ 401 `invalid credentials` |
| `POST /api/v1/auth/register` `{}` | 400 validation | ✅ 400 `invalid email` |
| `POST /api/v1/auth/reset-password` `{}` | 401 validation | ✅ 401 `invalid or expired reset token` |
| `POST /api/v1/auth/forgot-password` `{email:"smoke-test@example.com"}` | **503 `email_provider_not_configured`** (guard persists) | ✅ **503 `email_provider_not_configured`** |
| `GET /api/v1/auth/me` (no Bearer) | 401 | ✅ 401 `missing or malformed Authorization header` |
| `GET /api/v1/tenders` (no Bearer) | 401 | ✅ 401 `missing or malformed Authorization header` |

Полноценные business-вызовы (`GET /api/v1/me`, `/me/permissions`,
`/references/roles`, `/tenders?limit=5`) требуют валидный Bearer и
делегируются browser-smoke за оператором. Контракт без токена
(401 на каждом protected пути) — подтверждён.

## Bundle verification

Frontend bundle: `https://tender.su10.ru/assets/index-AznL5X1i.js`.

| Pattern | Count |
|---|---|
| `supabase.co` | **0** |
| `/auth/v1/token` | **0** |
| `/auth/v1/recover` | **0** |
| `/rest/v1/` | **0** |
| `GoTrueClient` | **0** |
| `@supabase/supabase-js` | **0** |
| `vendor-supabase-*.js` chunk referenced in `index.html` | **0** (chunk не эмитится, не загружается) |

App-auth endpoints inlined:

| Endpoint | Occurrences |
|---|---|
| `/api/v1/auth/login` | 1 |
| `/api/v1/auth/register` | 1 |
| `/api/v1/auth/forgot-password` | 1 |
| `/api/v1/auth/reset-password` | 1 |
| `/api/v1/auth/refresh` | 1 |
| `/api/v1/auth/logout` | 1 |
| `/api/v1/auth/me` | 1 |

### Bundle chunk list (prod)

```
dist/index.html                          1.78 kB
dist/assets/worker-B7YgltGE.js         306.13 kB
dist/assets/index-ByJfc6rL.css          23.61 kB
dist/assets/exportToExcel-Cnd2yX31.js    3.60 kB
dist/assets/vendor-react-CB2llGuE.js   180.48 kB
dist/assets/vendor-charts-p_RWlQ89.js  199.34 kB
dist/assets/vendor-xlsx-Qq8YJJ5u.js    965.77 kB
dist/assets/vendor-antd-0KRT3sfV.js   1,270.92 kB
dist/assets/index-AznL5X1i.js         1,333.20 kB
```

**`vendor-supabase-*.js` отсутствует** — chunk удалён вместе с SDK.

## Browser smoke (2026-05-25, operator-confirmed)

End-to-end user flow на `https://tender.su10.ru` — все шаги зелёные:

| Step | Observation |
|---|---|
| Login через `POST /api/v1/auth/login` | ✅ 200 |
| `*.supabase.co/*` запросов в Network panel | ✅ **0** (ни `/auth/v1/`, ни `/rest/v1/`) |
| `GET /api/v1/auth/me` (app-auth shape) | ✅ 200 |
| `GET /api/v1/me` (full profile + role JOIN) | ✅ 200 |
| `GET /api/v1/me/permissions` | ✅ 200 |
| `GET /api/v1/references/*` | ✅ 200 |
| `GET /api/v1/tenders` | ✅ 200 |
| BOQ / tender page загружается, business-запросы идут только через `/api/v1/*` | ✅ |
| WebSocket `wss://tender.su10.ru/api/v1/ws` подключается | ✅ |
| Forgot-password → POST `/api/v1/auth/forgot-password` | ✅ 503 `email_provider_not_configured`; UI рендерит controlled `<Result status="warning">` |
| False-positive «письмо отправлено» toast | ✅ NOT shown |
| Logout → POST `/api/v1/auth/logout` | ✅ 204/200 |
| localStorage `hubtender_app_auth_*` после logout | ✅ очищен |

End-to-end контракт SUPABASE_RUNTIME_REMOVED полностью подтверждён в
production:

- **Bundle**: `supabase.co`, `/auth/v1/`, `/rest/v1/`, `GoTrueClient`,
  `@supabase/supabase-js` отсутствуют (см. секцию «Bundle verification»).
- **Network на runtime**: 0 запросов на `*.supabase.co/*` за всю
  пользовательскую сессию (login → me → references → tenders → BOQ
  → forgot → logout).
- **Auth-runtime**: 100% через Go BFF `/api/v1/auth/*`, JWT RS256
  выдан локальным issuer'ом (kid `xDItcfIj5Kjn_…`).
- **Business-runtime**: 100% через Go BFF `/api/v1/*` + Yandex
  Managed PostgreSQL.
- **Realtime**: native WebSocket hub Go BFF (`/api/v1/ws`).

## Что НЕ сделано (по умыслу)

- Supabase project (`ocauafggjrqvopxjihas`) **физически НЕ удалён**.
  Он сохранён для:
  - Schema-генерации (`npm run gen:types` / `gen:schema` — dev-only
    тулчейн, в runtime не задействован).
  - Возможного rollback в случае непредвиденных проблем (DSN /
    JWKS-конфиг можно восстановить из git history).
  - Архивных миграционных артефактов в
    `archive/migrations/2026-05-db-cutover/`.

  Project можно деактивировать (pause) или снести позже отдельной
  операцией, **не блокирующей** этот деплой.

## Что было исправлено в этом раунде

См. полный diff в [43_SUPABASE_AUTH_REMOVAL_RESULT.md](43_SUPABASE_AUTH_REMOVAL_RESULT.md)
+ forensic-аудит в [44_SUPABASE_DATA_CALLS_AUDIT.md](44_SUPABASE_DATA_CALLS_AUDIT.md).
Кратко:

- Backend: `AUTH_MODE`-ветвление, Supabase JWT verify, `keyfunc` import — удалены.
- Frontend: `supabase.auth.*` вызовы — 0; `AUTH_MODE`-branches — 0;
  `src/lib/auth/mode.ts` удалён; `src/lib/supabase/client.ts` удалён.
- Package: `@supabase/supabase-js` снят из `package.json`; `npm install`
  удалил 9 пакетов.
- Build: `vite.config.ts` больше не содержит manualChunk
  `vendor-supabase`; `scripts/build-prod.mjs` больше не валидирует
  `VITE_SUPABASE_*`; CI workflow обновлён.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_AUTH_MODE`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`,
  `AUTH_MODE` — удалены из шаблонов.
- Docs: `CLAUDE.md`, `README.md`, `docs/RUNTIME_ENV.md`,
  `docs/ARCHITECTURE.md` обновлены под app-only архитектуру.

## Что осталось как gigiena (не блокер)

Эти переменные ещё могут лежать в `.env.prod` / `.env.production.yandex`
на проде, но **больше не читаются** — можно убрать «как только удобно»:

| Env file | Vars to clean |
|---|---|
| `/srv/sites/tender.su10.ru/server/.env.prod` (backend) | `AUTH_MODE`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_SECRET` |
| `/opt/hubtender-build/.env.production.yandex` (frontend build env) | `VITE_AUTH_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |

После удаления: следующий deploy должен пройти без изменения поведения.

## Rollback note

Если внезапно что-то сломается:

- **Frontend rollback**: `rsync` `/srv/sites/tender.su10.ru/backups/public/public.backup-20260525-141109/`
  обратно в `/srv/sites/tender.su10.ru/public/`. Старый bundle ещё
  содержал supabase-js + читал `VITE_SUPABASE_URL`/`KEY` — если эти
  env-vars уже удалены, прежняя версия упадёт при загрузке с
  «Supabase configuration is missing». Решение: при rollback также
  восстановить env-vars во `.env.production.yandex`, либо просто не
  удалять их до окончания обкатки нового deploy.
- **Backend rollback**: `git revert 40fd7c4 && bash scripts/deploy-server.sh backend`.
  Предыдущий backend уже работал в `AUTH_MODE=app` — обратная
  совместимость гарантирована.
- **DB rollback**: схема не менялась; `app_auth.*` таблицы остаются.

## Related docs

- [38_APP_AUTH_CUTOVER_RESULT.md](38_APP_AUTH_CUTOVER_RESULT.md) — initial production cutover
- [42_APP_AUTH_PASSWORD_RECOVERY_RESULT.md](42_APP_AUTH_PASSWORD_RECOVERY_RESULT.md) — password recovery + production guard
- [43_SUPABASE_AUTH_REMOVAL_RESULT.md](43_SUPABASE_AUTH_REMOVAL_RESULT.md) — code-level Supabase runtime removal
- [44_SUPABASE_DATA_CALLS_AUDIT.md](44_SUPABASE_DATA_CALLS_AUDIT.md) — forensic audit
- **45 (this)** — production deploy result for runtime removal
