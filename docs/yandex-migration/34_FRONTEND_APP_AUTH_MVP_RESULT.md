# 34 — Frontend App-Auth MVP

> Phase 6 frontend cutover: AuthContext / API client / WS / Login can now
> drive sign-in via Go BFF (`AUTH_MODE=app`). Supabase SDK + bridge stay
> bundled for fallback; nothing was deployed or pushed.

## Changed files

### New (`src/lib/auth/`)
| File | Purpose |
|---|---|
| [`types.ts`](../../src/lib/auth/types.ts) | `AuthMode`, `AppSession`, `AppAuthUser`, `AuthResultPayload`, `AppAuthEvent`, `AppAuthError` |
| [`mode.ts`](../../src/lib/auth/mode.ts) | `getAuthMode()` + `AUTH_MODE` const reading `import.meta.env.VITE_AUTH_MODE` |
| [`storage.ts`](../../src/lib/auth/storage.ts) | `localStorage` wrapper, prefix `hubtender_app_auth_`, sweeps full prefix on signOut, type-guards stored shape |
| [`events.ts`](../../src/lib/auth/events.ts) | Synchronous emitter for `INITIAL_SESSION` / `SIGNED_IN` / `SIGNED_OUT` / `TOKEN_REFRESHED` / `USER_UPDATED`; subscription handle mirrors Supabase shape |
| [`client.ts`](../../src/lib/auth/client.ts) | `signInWithPassword`, `signOut`, `getSession`, `getUser`, `getAccessToken`, `refreshSession`, `me`, `hydrate`, `onAuthStateChange`, `getCurrentUserId` |

### Modified
| File | Change |
|---|---|
| [`src/contexts/AuthContext.tsx`](../../src/contexts/AuthContext.tsx) | Branch on `AUTH_MODE`: app-mode wires `onAppAuthStateChange` + `hydrate` + `appAuthMe`; legacy supabase branch untouched. Both branches reuse `loadUserData()` so role badge / allowed_pages payload is identical. `signOut()` and `refreshUser()` also mode-aware. |
| [`src/lib/api/client.ts`](../../src/lib/api/client.ts) | `getToken()` reads from `appAuthGetAccessToken()` in app mode (auto-refresh on near-expiry). On 401 in app mode: one `refreshSession()` + retry; if refresh fails it has already emitted `SIGNED_OUT`. |
| [`src/lib/realtime/ws.ts`](../../src/lib/realtime/ws.ts) | WS connect token source unified through the same auth-mode branch. WS handler is dual-mode in the BFF — same token works. |
| [`src/pages/Auth/Login.tsx`](../../src/pages/Auth/Login.tsx) | `handleLogin` calls `appAuthSignIn()` in app mode; maps `AppAuthError.code` to existing toast wording. The pending/blocked/rejected screens' "Выйти" buttons also branch (`appAuthSignOut` vs `supabase.auth.signOut`). Supabase branch otherwise unchanged. |
| [`src/pages/Auth/Register.tsx`](../../src/pages/Auth/Register.tsx) | Early return in app mode → controlled `<Result status="info">` with "Регистрация временно недоступна. Обратитесь к администратору." Supabase form untouched in supabase mode. |
| [`src/pages/Auth/ForgotPassword.tsx`](../../src/pages/Auth/ForgotPassword.tsx) | Early return in app mode → "Сброс пароля временно недоступен" placeholder card. |
| [`src/pages/Auth/ResetPassword.tsx`](../../src/pages/Auth/ResetPassword.tsx) | Split into `ResetPasswordAppPlaceholder` + `ResetPasswordSupabase`; default-export wrapper picks one by `AUTH_MODE`. Done this way (instead of an in-function early return) so `useEffect` calls in the supabase variant don't violate `react-hooks/rules-of-hooks`. |
| [`src/pages/CostRedistribution/hooks/useSaveResults.ts`](../../src/pages/CostRedistribution/hooks/useSaveResults.ts) | Replaced one stray `supabase.auth.getUser()` with mode-aware `appAuthGetCurrentUserId()` (only place outside `Auth/` that read user id directly from Supabase). |

### Env
| File | Change |
|---|---|
| [`.env.production.yandex.example`](../../.env.production.yandex.example) | Added `VITE_AUTH_MODE=app` block (top of file, with rationale comment). Existing `VITE_API_MODE=go` + per-domain flags untouched. |

## Auth modes

`src/lib/auth/mode.ts` reads `import.meta.env.VITE_AUTH_MODE` at build time (Vite inlines the literal). Recognised values:

| Value | Behaviour | When to use |
|---|---|---|
| `app` | Sign-in / refresh / logout / me all go to Go BFF (`/api/v1/auth/*`). Session in localStorage. Auto-refresh 60 s before expiry, single-flight to avoid family revoke. | Phase 6 cutover, prod (`.env.production.yandex.example`) |
| `supabase` | Legacy: `supabase.auth.signInWithPassword`, AuthContext drives off `supabase.auth.onAuthStateChange`. | Local dev with legacy stack |
| _empty / other_ | Falls back to `supabase` with a documented warning. | Defensive default; documented in `.env.production.yandex.example` |

## App auth client behaviour

- `signInWithPassword(email, password)` — POST `/api/v1/auth/login`; on 401 → `AppAuthError.code='invalid_credentials'`, on 403 → `'access_blocked'`. On success: persists `AppSession`, emits `SIGNED_IN`.
- `getAccessToken()` — returns cached token; if `expires_at - now < 60s`, kicks `refreshSession()` first.
- `refreshSession()` — POST `/api/v1/auth/refresh`. **Coalesces concurrent callers** via module-level inflight promise — critical because the BFF revokes the whole token family on parallel refresh-token consumption.
- `signOut()` — purges local state synchronously, then best-effort POST `/api/v1/auth/logout` (never rejects, never blocks UX).
- `me()` — GET `/api/v1/auth/me`; updates `session.user` in storage and emits `USER_UPDATED`. On 401 → SIGNED_OUT.
- `hydrate()` — called once at AuthContext mount; emits `INITIAL_SESSION` for the subscription.
- `onAuthStateChange(listener)` — returns `{ data: { subscription: { unsubscribe } } }` (Supabase-compatible shape so the AuthContext callsite stays uniform).

## Storage keys

All `localStorage` keys begin with `hubtender_app_auth_`:

| Key | Contents |
|---|---|
| `hubtender_app_auth_session` | JSON `AppSession` — access + refresh tokens, expiry epochs, user payload |

`clearSession()` (called on signOut / refresh failure) sweeps every key with this prefix — so a future schema change leaves no orphans. Plaintext password is never persisted.

## Register / forgot / reset — temporary behaviour

Phase 6 backend does not yet expose these endpoints (DB tables for reset are ready, handlers are deferred). The frontend shows a controlled `<Result status="info">` instead of a broken form in app mode:

| Page (app mode) | Message |
|---|---|
| `/register` | "Регистрация временно недоступна. Обратитесь к администратору." |
| `/forgot-password` | "Сброс пароля временно недоступен. Обратитесь к администратору." |
| `/reset-password` | "Сброс пароля временно недоступен. Обратитесь к администратору." |

Supabase branches (when `AUTH_MODE !== 'app'`) keep their original Supabase Auth flows untouched.

## Remaining Supabase usage in `src/`

Grep `supabase.auth` returns 23 hits, distributed:

| Location | Status |
|---|---|
| `AuthContext.tsx` (3) | Inside `else` / non-`app` branch only |
| `lib/api/client.ts` (1) | Inside `else` in `getToken()` |
| `lib/realtime/ws.ts` (1) | Inside `else` in `connect()` |
| `lib/supabaseWithAudit.ts` (3) | Deprecated module per CLAUDE.md; not actively imported in app-mode runtime |
| `pages/Auth/Login.tsx` (4) | One in `else` branch of `handleLogin`; three in pending/blocked/rejected card `onClick` (also mode-branched) |
| `pages/Auth/Register.tsx` (3) | Below the `AUTH_MODE === 'app'` early-return — unreachable in app mode |
| `pages/Auth/ForgotPassword.tsx` (1) | Same — below the early-return |
| `pages/Auth/ResetPassword.tsx` (5) | All inside `ResetPasswordSupabase` component, which the wrapper never mounts in app mode |
| `pages/CostRedistribution/hooks/useSaveResults.ts` (1) | Inside `else` of `AUTH_MODE === 'app'` |

Grep `supabase.{from|rpc|channel|removeChannel}` (excluding `database.types.ts`): **0**. Business-data calls already migrated to Go BFF (Phase 4/5).

## Build / test results

```
npm run typecheck         → OK (tsc --noEmit, no errors)
npm run lint -- --max-warnings 0  → OK (eslint, zero warnings)
npm run build             → OK  (default mode, no .env.production loaded)
npm run build:prod        → OK  (--mode production.yandex, .env.production.yandex consumed)
                            ✓ built in ~50 s
```

## Bundle verification (`dist/assets/index-*.js` from `build:prod`)

| Check | Result |
|---|---|
| `/api/v1/auth/login` literal in bundle | ✅ OK |
| `/api/v1/auth/refresh` literal | ✅ OK |
| `/api/v1/auth/logout` literal | ✅ OK |
| `/api/v1/auth/me` literal | ✅ OK |
| `"app"` mode literal inlined | ✅ 3 occurrences (mode.ts + 2 callsites) |
| `hubtender_app_auth` storage prefix | ✅ 1 occurrence |
| Supabase URL (`ocauafggjrqvopxjihas.supabase.co`) | ✅ 1 occurrence (anon-bridge constant) — by design |
| `/auth/v1/token` literal (Supabase login path) | 0 (Supabase SDK builds the URL at runtime; not a tree-shake leak — the SDK is still bundled because we keep the fallback) |

`/.well-known/jwks.json` is NOT in the frontend bundle — frontend never fetches JWKS. By design: the BFF holds the signing key and validates tokens server-side; only third-party RPs would want JWKS.

## Final status

**FRONTEND_APP_AUTH_MVP_OK**

## Blockers / warnings

| # | Item | Status |
|---|---|---|
| 1 | `react-hooks/rules-of-hooks` would fire on an early-return-before-useEffect pattern in `ResetPassword` | Resolved by splitting into 2 components |
| 2 | `useSaveResults.ts` had a stray `supabase.auth.getUser()` that returns null in app mode | Resolved with `appAuthGetCurrentUserId()` (mode-aware) |
| 3 | `supabaseWithAudit.ts` (deprecated) still calls `supabase.auth.getSession()` — would return null in app mode | Acknowledged. CLAUDE.md marks the module as deprecated. Any remaining caller would silently degrade. Out of scope for this MVP; flag for Phase 6 cleanup. |
| 4 | The frontend has NOT been manually clicked through. No live login was performed against a running BFF in app mode. | Smoke / e2e deferred — needs a fresh launch with `VITE_AUTH_MODE=app` against `AUTH_MODE=dual` BFF; backend smoke (doc 33) already validated the server side. |
| 5 | `register/forgot/reset` endpoints not implemented on backend; frontend shows informational placeholder | By design (per spec). Backend follow-up task. |

## Open / non-blocker notes

- `AUTH_MODE` is a compile-time constant — switching it requires a rebuild. Toggling via runtime is intentionally not supported.
- Refresh-coalescing prevents the BFF's token-family reuse-detection from killing parallel API calls. If you ever see `refresh_reuse_detected` in `app_auth.auth_events` for an active user, it's almost certainly a multi-tab race — the in-flight promise is per-tab, not cross-tab.
- `localStorage` is single-tab safe for the session payload, but two tabs simultaneously refreshing WILL trigger reuse-detection (same family from two contexts). Acceptable for MVP; cross-tab broadcast can come later via `BroadcastChannel` or `storage` event listener.

## What is NOT done

- ❌ frontend smoke/e2e in a browser
- ❌ deploy / push / production env change
- ❌ removal of Supabase SDK or `lib/supabase` module
- ❌ removal of supabase-mode branches
- ❌ `register` / `forgot-password` / `reset-password` HTTP endpoints on the BFF (storage table ready, handler deferred)
- ❌ cross-tab refresh coordination (`BroadcastChannel`)
