# 41 — App-Auth Register Result

> Phase 6 next-phase MVP: production registration through Go app-auth.
> One `POST /api/v1/auth/register` provisions `auth.users` +
> `public.users` + admin notification in a single transaction. Frontend
> placeholder for `/register` replaced with a working form. No deploy.

## Final status

**APP_AUTH_REGISTER_OK**

## Endpoint

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | public (no Bearer) | `{email, password, full_name}` | 201 `{user_id, email, access_status}` |

Error mapping:

| Error | HTTP | Trigger |
|---|---|---|
| `ErrInvalidEmail` | 400 | empty / no `@` |
| `ErrFullNameRequired` | 400 | empty after trim |
| `ErrPasswordTooShort` | 400 | < 6 chars (matches frontend form rule) |
| `ErrEmailAlreadyExists` | 409 | case-insensitive duplicate in `auth.users` |
| anything else | 500 | logged via `apierr.InternalError` (separate observability rollout — see [40 doc](40_TENDER_POSITIONS_OVERVIEW_FIX_RESULT.md) F4) |

NO tokens issued on success: fresh accounts land in `access_status="pending"`
and must wait for admin approval before login (admin notification fans out
inside the same DB transaction). The frontend redirects to `/login` with
the same "запрос отправлен" success toast that the supabase-mode branch used.

## Logic / safety

1. **Email** normalised `LOWER(TRIM(...))`.
2. **Password** validated (≥ 6 chars) and **hashed via `auth.HashPassword`** (bcrypt cost 10, Supabase-compatible `$2a$10$…` prefix). Plaintext password is never logged, never stored, never returned in the response.
3. **Duplicate** guard inside the transaction:
   ```sql
   SELECT id::text FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1
   ```
4. **`auth.users` INSERT** with `gen_random_uuid()` for `id`, `email_confirmed_at = NOW()` (the registration form is the confirmation; legacy email-link flow is intentionally not modelled here). Token / change string columns rely on schema-level `DEFAULT ''`.
5. **`role_code` PINNED to `'engineer'` server-side.** The request body does NOT accept `role_code`, `allowed_pages`, or `access_status`. Self-elevation to `administrator` / `director` / `developer` via this endpoint is impossible.
6. **`allowed_pages`** sourced from `public.roles.allowed_pages` for `engineer`.
7. **First-user check** carries over from the legacy `repository/user_register.go` flow: empty `public.users` + privileged role → `access_status='approved'` with `approved_by = self`. Because role is pinned to `engineer` (non-privileged), this branch is currently dead code; kept for future "bootstrap admin" flows.
8. **`public.users` INSERT** with `access_status='pending'` (default for normal sign-ups).
9. **`public.notifications` INSERT** with `type='pending'`, `related_entity_type='registration_request'`, `related_entity_id=<new user id>` — same shape the admin UI already filters on.
10. Everything wrapped in `pgx.Tx` with `tx.Rollback()` on any error.

## Changed files

### Backend
| File | Δ | Purpose |
|---|---|---|
| [`backend/internal/auth/errors.go`](../../backend/internal/auth/errors.go) | +12 | `ErrEmailAlreadyExists`, `ErrPasswordTooShort`, `ErrInvalidEmail`, `ErrFullNameRequired` sentinels |
| [`backend/internal/auth/models.go`](../../backend/internal/auth/models.go) | +21 | `RegisterRequest` (wire body), `RegisterResult` (wire response) |
| [`backend/internal/auth/repository.go`](../../backend/internal/auth/repository.go) | +99 | `RegisterInput`, `RegisterResultDB`, `RegisterUser` tx |
| [`backend/internal/auth/service.go`](../../backend/internal/auth/service.go) | +50 | `Service.Register` (normalize + hash + delegate); `repo` interface extended |
| [`backend/internal/auth/handlers.go`](../../backend/internal/auth/handlers.go) | +44 | `Handler.Register` (HTTP) |
| [`backend/cmd/server/main.go`](../../backend/cmd/server/main.go) | +1 | Route `POST /api/v1/auth/register` |
| [`backend/internal/auth/service_test.go`](../../backend/internal/auth/service_test.go) | +90 | 6 service-level tests + `fakeRepo.RegisterUser` |
| [`backend/internal/auth/handlers_test.go`](../../backend/internal/auth/handlers_test.go) | +64 | 4 handler-level tests (incl. "no plaintext / no $2a$ in response body") |

### Frontend
| File | Δ | Purpose |
|---|---|---|
| [`src/lib/auth/client.ts`](../../src/lib/auth/client.ts) | +53 | `registerWithPassword({email, password, full_name})` + `RegisterPayload`/`RegisterResult` types + error mapping |
| [`src/pages/Auth/Register.tsx`](../../src/pages/Auth/Register.tsx) | −44 / +35 | Removed early-return placeholder; `handleRegister` now branches: app-mode calls `appAuthRegister`, supabase-mode unchanged. Imports cleaned (`Result`, `ArrowLeftOutlined` no longer used in app-branch). |

Forgot/reset placeholders intentionally NOT touched (separate phase).

## Tests / build / typecheck / lint

| Check | Result |
|---|---|
| `gofmt -l <my files>` | ✅ clean (pre-existing repo-wide unformatted files out of scope) |
| `go test ./internal/auth ./internal/handlers ./internal/repository` | ✅ all OK (auth package added 10 new tests, all pass) |
| `go build ./cmd/server` | ✅ |
| `npm run typecheck` | ✅ |
| `npm run lint -- --max-warnings 0` | ✅ |
| `npm run build:prod` (`--mode production.yandex`, includes Sentry source-map upload) | ✅ |

### New test coverage (`backend/internal/auth/`)

- `TestRegister_OK` — happy path; verifies email lower/trim, `access_status="pending"`, bcrypt prefix `$2a$`, public.users row written, role pinned to `engineer`.
- `TestRegister_DuplicateEmail` — case-insensitive (`DUP@…` vs `dup@…`) → `ErrEmailAlreadyExists`.
- `TestRegister_WeakPassword` — 5-char password → `ErrPasswordTooShort`.
- `TestRegister_EmptyEmail` — whitespace-only → `ErrInvalidEmail`.
- `TestRegister_MalformedEmail` — `not-an-email` → `ErrInvalidEmail`.
- `TestRegister_EmptyFullName` — whitespace-only → `ErrFullNameRequired`.
- `TestHandler_Register_Created` — 201 + correct response shape.
- `TestHandler_Register_DuplicateEmail_Returns409` — wire mapping.
- `TestHandler_Register_WeakPassword_Returns400` — wire mapping.
- `TestHandler_Register_DoesNotReturnPasswordOrHash` — response body must contain neither the plaintext password nor any `$2a$` hash prefix.

### Bundle sanity (`dist/assets/index-*.js` from `build:prod`)

| Check | Result |
|---|---|
| `/api/v1/auth/register` literal inlined | ✅ 1 occurrence |
| `*.supabase.co/auth/v1/signup` literal | **0** (Supabase signup path not present in app-mode bundle) |

## Frontend behaviour

- `/register` page in app mode now renders the full form (full_name / email / password / confirm).
- On submit:
  - 200 → toast "Запрос на регистрацию отправлен!" + `navigate('/login')`.
  - 409 → toast "Пользователь с таким email уже зарегистрирован".
  - 400 → toast surfaces server-side `detail` ("password too short (min 6 chars)" etc.) localised by caller logic.
  - network failure → toast "Сервис недоступен".
- Supabase-mode branch unchanged (legacy dev still works).
- Forgot/Reset placeholders untouched — separate phase.

## Deploy recommendation

Backend + frontend deploy both required (both sides changed):

```bash
# After git push origin main:
bash scripts/deploy-production.sh both
```

Post-deploy smoke (operator-driven, in a browser):
1. Open https://tender.su10.ru/register
2. Fill form with a NEW email + name + password ≥ 6 chars
3. Submit → expect "запрос отправлен" toast + redirect to `/login`
4. DevTools Network: `POST /api/v1/auth/register` → 201; **0** hits on `*.supabase.co/auth/v1/signup`
5. Admin UI: new "registration_request" notification visible
6. Approve the new user via admin → user can now log in
7. Sanity: try the same email again → 409 toast "Пользователь с таким email уже зарегистрирован"
8. Sanity: try password "123" → 400 toast with policy detail

## Rollback note

If the new endpoint causes issues:
- Backend rollback: revert the commit, redeploy backend. Frontend will get 404 on `/register` POST → toast "registration failed" — degraded but not data-corrupting.
- Frontend rollback: redeploy a prior bundle (or restore from `public.backup-…`) — Supabase-mode Register form returns. Backend new endpoint stays (idle, no callers in app mode).
- DB rollback: no schema changes; only INSERTs into existing `auth.users` / `public.users` / `public.notifications`. Test-mode rows can be deleted by an admin via the existing user-management UI.

## Open notes / follow-ups

- ⚠️ The duplicate-email check is a `SELECT` inside the transaction, NOT a DB unique constraint on `auth.users.email`. Two simultaneous POSTs with the same email can race past the SELECT and both insert. Acceptable for the current low-TPS sign-up flow; if it becomes an issue, add a unique index on `LOWER(auth.users.email)` in a follow-up migration.
- ⚠️ Bare-bones validation. No email-deliverability check (we don't send a confirmation email), no password complexity rules beyond ≥ 6 chars, no rate limiting on `/api/v1/auth/register`. Sign-up form is gated by manual admin approval anyway.
- ℹ️ `apierr.InternalError(...)` still swallows the inner err on the catch-all branch. The new `apierr.InternalFromErr` helper (from 40 doc) is not yet rolled out here. Consistent with the wider F4 follow-up.
- ℹ️ `role_code='engineer'` is pinned in the repo SQL. If a future flow needs `role_code='estimator'` etc. server-side, change the constant (and document it). The HTTP request body still must NOT accept role_code.

## Related docs

- [32_APP_AUTH_BACKEND_MVP_RESULT.md](32_APP_AUTH_BACKEND_MVP_RESULT.md) — backend MVP (login/refresh/logout/me/jwks)
- [34_FRONTEND_APP_AUTH_MVP_RESULT.md](34_FRONTEND_APP_AUTH_MVP_RESULT.md) — frontend MVP (placeholders for register/forgot/reset)
- [38_APP_AUTH_CUTOVER_RESULT.md](38_APP_AUTH_CUTOVER_RESULT.md) — production cutover
- **41 (this)** — register endpoint live

## What was NOT done (per spec)

- ❌ no deploy
- ❌ no push
- ❌ DATABASE_URL untouched
- ❌ AUTH_MODE / Supabase env untouched
- ❌ Supabase SDK / fallback NOT removed
- ❌ forgot / reset endpoints + pages — separate phase
- ❌ change-password / change-email flows — separate phase
- ❌ unique index on `auth.users.email` — follow-up (see Open notes)
