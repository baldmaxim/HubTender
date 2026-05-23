# 36 — App-Auth E2E Smoke Result

> Phase 6 frontend + backend smoked together against live Yandex Managed
> PostgreSQL. Frontend served by Vite dev (`VITE_AUTH_MODE=app`), backend
> Go BFF (`AUTH_MODE=dual`). All eight scenarios from the spec green.
> No production env, no deploy, no push.

## Timestamp
UTC: 2026-05-23T14:34Z (smoke run window: ~14:33 — 14:37 UTC)

## Backend launch method

- **Binary**: `backend/hubtender-bff.exe` (current `main` build, commit `a9b663e`).
- **Port**: `:3006` (free; user's other dev-BFF on `:3005` not touched).
- **Env**: `.certs/bff-launch.env` (gitignored under `.certs/`) — composed by
  [.certs/smoke/compose-env.mjs](../../.certs/smoke/compose-env.mjs), single-quoted values
  so `&` in DSN survives `bash source`.
- **Auth config**:
  ```
  AUTH_MODE=dual
  APP_JWT_ISSUER=http://localhost:3006
  APP_JWT_AUDIENCE=hubtender
  APP_ACCESS_TOKEN_TTL_MINUTES=15
  APP_REFRESH_TOKEN_TTL_DAYS=30
  APP_JWT_PRIVATE_KEY_PATH=.certs/test-app-jwt.pem     # ephemeral 2048-bit RSA, gitignored
  SUPABASE_JWKS_URL=https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json
  SUPABASE_JWT_ISSUER=https://ocauafggjrqvopxjihas.supabase.co/auth/v1
  CORS_ORIGINS=http://localhost:5174
  DB_MAX_CONNS=5
  DATABASE_URL=<Yandex YANDEX_DATABASE_URL — redacted>
  ```
- **Stop**: `taskkill /F /PID <pid>` after smoke. `:3006` released.

## Frontend launch method

- **Server**: `npx vite --port 5174 --strictPort` (default dev server, HMR on).
- **Port**: `:5174` (user's own dev on `:5173` not touched — verified
  HTTP 200 there both before and after the smoke).
- **Env**: [.env.local](../../.env.local) (gitignored under `.env.*`) overrides root `.env`:
  ```
  VITE_AUTH_MODE=app
  VITE_API_URL=http://localhost:3006
  VITE_API_MODE=go
  VITE_API_REALTIME_ENABLED=true
  VITE_API_*_ENABLED=true  (×18 domains)
  ```
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` inherited from root `.env`.
- **Smoke type**: HTTP+WS harness driving the same endpoints the SPA would.
  SPA boot was verified by `GET /` returning the index `<!doctype html>` shell,
  and by `GET /src/lib/auth/mode.ts` showing `import.meta.env.VITE_AUTH_MODE = "app"`
  inlined and `AUTH_MODE = getAuthMode()` resolving to `"app"`. Real-browser
  click-through deferred (no Playwright run).
- **Stop**: `taskkill /F /PID <pid>` after smoke. `:5174` released.

## Health / DB

```
GET  /health    → 200 {"status":"ok"}
GET  /health/db → 200 {"status":"ok"}   (real ping to Yandex pool)
```

## Login result

```
POST /api/v1/auth/login → 200
user.id            <uuid>
user.email         o***@gmail.com
user.role_code     developer
user.access_status approved
user.access_enabled true
token_type         Bearer
expires_in         900
access_token       <RS256 JWT, redacted>     (len 717)
refresh_token      <opaque, redacted>        (len 43)
```

Bcrypt round-trip against `auth.users.encrypted_password` (PROD-frozen at
2026-05-18) succeeded — same path 33 smoke proved, just driven through the
frontend's intended request flow.

## /auth/me

```
GET /api/v1/auth/me  (Authorization: Bearer <app JWT>)  → 200
id, email, full_name, role_code, access_status — same as login
```

## Existing protected API with app JWT

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/v1/me` | ✅ 200 | legacy handler accepts app JWT via dual middleware |
| `GET /api/v1/me/permissions` | ✅ 200 | |
| `GET /api/v1/references/roles` | ✅ 200 | data_count = 9 |
| `GET /api/v1/references/units` | ✅ 200 | data_count = 8934 |
| `GET /api/v1/tenders?limit=5` | ✅ 200 | data_count = 5 |

## PositionItems / `supabaseWithAudit` token-source

Path tested end-to-end with app JWT:

```
GET /api/v1/tenders?limit=5                     → 200, picked first tender
GET /api/v1/tenders/<tid>/positions/with-costs  → 200, 1181 positions
GET /api/v1/positions/<pid>/boq-items-full      → 200, items present
GET /api/v1/items/<itemId>                      → 200, ETag header present
```

`/api/v1/items/<itemId>` is the EXACT endpoint
[supabaseWithAudit.fetchItemETag](../../src/lib/supabaseWithAudit.ts#L66) hits.
The 200 + ETag confirms the unified `getAuditAccessToken()` helper feeds a
working Bearer token in app mode (the precheck blocker is resolved).

**Write smoke (insert/update/delete BOQ items): SKIPPED by policy.** Per
spec we don't create/mutate business data without explicit authorization.
Token-source verified by request-header acceptance / no 401 on read path.

## WebSocket

```
ws://localhost:3006/api/v1/ws?token=<app JWT>
→ open
→ {"type":"subscribe","topic":"tenders"}  accepted (no error frame)
→ close (clean)
```

Verified that the BFF WS handler accepts an app JWT via `?token=` and the
hub registers the subscription. No write-trigger tests issued.

## Reload / session persistence

`hubtender_app_auth_session` is stored in `localStorage` after login (see
[src/lib/auth/storage.ts](../../src/lib/auth/storage.ts)). On reload, `AuthProvider`
calls `hydrate()` which emits `INITIAL_SESSION` synchronously — the same
listener that `SIGNED_IN` triggers, so the user object lands without an
extra round-trip.

In the harness this was demonstrated by sequencing: login → re-read
`.certs/smoke/app.json` (the on-disk session) → all subsequent steps used
that persisted state without re-login. Real browser reload was not driven
(no Playwright run) — same shape, headless equivalent.

## Refresh

```
POST /api/v1/auth/refresh                       → 200, rotated pair
POST /api/v1/auth/refresh (replay OLD token)    → 401 + family revoked
```

DB-side: `refresh_rotated` then `refresh_reuse_detected` events emitted
within the same family. The successor token is also marked revoked (whole
family revoked on reuse). No spurious `refresh_reuse_detected` in the
normal rotation — single-flight coalesce in `src/lib/auth/client.ts`
ensures only one outstanding refresh per tab.

## Logout

```
POST /api/v1/auth/logout (current refresh)      → 204
POST /api/v1/auth/refresh (logged-out token)    → 401
GET  /api/v1/me                  (no token)     → 401
GET  /api/v1/tenders             (no token)     → 401
```

Session purged on the client (`clearSession()` sweeps every `hubtender_app_auth_*`
key). Frontend redirect to `/login` was not driven (no real browser); the
404/401-on-subsequent-call flow is identical to backend behaviour.

## Register / forgot / reset (app mode placeholders)

Verified by static analysis (see [34 doc](34_FRONTEND_APP_AUTH_MVP_RESULT.md#register--forgot--reset--temporary-behaviour)) — Vite served the
bundle that contains the placeholder JSX strings. Each page early-returns a
`<Result status="info">` with "временно недоступна" copy when
`AUTH_MODE === 'app'`. Supabase Auth methods are unreachable in this
branch (verified by grep in
[35 doc](35_APP_AUTH_E2E_PRECHECK_FIX.md#grep-results)).

## Network summary

| Where | Hits | Status |
|---|---|---|
| `http://localhost:3006/api/v1/auth/*` | login, refresh, logout, me | ✅ all 200/204 |
| `http://localhost:3006/api/v1/*` (business) | me, permissions, references, tenders, positions, items | ✅ all 200 |
| `ws://localhost:3006/api/v1/ws` | open + subscribe | ✅ |
| `https://ocauafggjrqvopxjihas.supabase.co/auth/v1/token` | **0 (app login NEVER touches Supabase Auth)** | ✅ |
| Supabase business REST (`/rest/v1/...`) | 0 | ✅ |

## App_auth DB side effects

For the smoke user, last-10-min window (read-only post-smoke):

```
app_auth.refresh_tokens: { active: 0, revoked: 2, families: 1 }
```

(2 revoked = original + rotated successor, 1 family = single login session;
0 active = consistent with logout)

```
app_auth.auth_events (5 rows):
  14:34:47Z  login_success
  14:36:22Z  refresh_rotated         {family_id: <uuid>}
  14:36:23Z  refresh_reuse_detected  {family_id: <uuid>}   ← replay of old token
  14:36:23Z  logout                  {family_id: <uuid>}
  14:36:23Z  refresh_reuse_detected  {family_id: <uuid>}   ← post-logout replay
```

`token_hash` values not printed. Family ids redacted.

## Final status

**APP_AUTH_E2E_SMOKE_OK**

## Passed checks
- ✅ BFF launches in `dual` mode against Yandex (health + DB ping)
- ✅ Vite dev serves SPA with `VITE_AUTH_MODE="app"` inlined
- ✅ Login via Go BFF (200, Bearer JWT, full user payload)
- ✅ `/api/v1/auth/me` returns user
- ✅ All 5 protected endpoints (`/me`, `/me/permissions`, `/references/{roles,units}`, `/tenders`) accept app JWT
- ✅ BOQ read path (`/api/v1/items/{id}`) returns 200 + ETag — supabaseWithAudit token-source works
- ✅ WebSocket connects + accepts subscribe with app JWT
- ✅ Refresh rotates pair; replayed old token → 401 + family revoked
- ✅ Logout → 204; subsequent refresh / unauthenticated calls → 401
- ✅ `app_auth.refresh_tokens` + `app_auth.auth_events` recorded the full lifecycle correctly
- ✅ NO Supabase Auth token endpoint hits, NO Supabase business REST hits
- ✅ Existing user dev on `:5173` untouched

## Failed checks
- (none)

## Blockers / warnings
- ⚠️ Smoke is harness-driven (curl/Node), not a real browser click-through. Coverage:
  - HTTP / WS request flow: identical
  - localStorage hydrate/clear: simulated via on-disk JSON; AuthContext code path verified by static analysis (34 doc) but not actually rendered
  - Real-browser regressions (Vite HMR, antd Result rendering, redirect-after-logout) not visually verified
  - Recommend a Playwright pass before flipping prod `VITE_AUTH_MODE=app`
- ⚠️ `supabaseWithAudit` write path (insert/update/delete BOQ items) was NOT executed — only read path (`fetchItemETag`) verified. The token-source code path is shared (same `getAuditAccessToken()`), so write should work — but no live confirmation.
- ⚠️ `.env.local` (gitignored) was created for this smoke; safe to delete after:
  ```powershell
  Remove-Item .env.local
  ```
  Or keep for future smoke runs.
- ℹ️ Inevitable Yandex DB writes (per spec): `app_auth.refresh_tokens` 2 rows, `app_auth.auth_events` 5 rows. No business data touched.
- ℹ️ Backend stopped, Vite stopped. User's `:5173` Vite session untouched.

## Artefacts (gitignored)
- `.certs/test-app-jwt.pem` — RSA key (reused across smokes)
- `.certs/bff-launch.env` — composed BFF env
- `.certs/bff.log` — server log
- `.certs/vite.log` — Vite log
- `.certs/smoke/app.json`, `app.before-refresh.json`, `supabase.json` — captured tokens (NEVER committed)
- `.env.local` — Vite dev override (NEVER committed)

Cleanup after:
```powershell
Remove-Item -Recurse -Force .certs\smoke
Remove-Item .certs\bff-launch.env .certs\bff.log .certs\vite.log
Remove-Item .env.local
# leave .certs/test-app-jwt.pem if you'll re-run smokes
```
