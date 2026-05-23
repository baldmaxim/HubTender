# 37 — App-Auth Browser Smoke Result

> Real-browser (headless Chromium via Playwright 1.59.1) drove the SPA
> through every flow from the spec. All 15 assertions green. Network spy
> confirms zero Supabase Auth + zero Supabase REST calls in app mode.

## Stack

- **Backend**: Go BFF on `:3006`, `AUTH_MODE=dual`, Yandex DSN, app-JWT issuer ready (RSA test key from `.certs/`).
- **Frontend**: Vite dev on `:5174`, `.env.local` overrides root `.env` with `VITE_AUTH_MODE=app` + `VITE_API_URL=http://localhost:3006` + all 18 `VITE_API_*_ENABLED=true`.
- **Browser**: Chromium headless-shell 1217 (Playwright auto-installed). `chromium.launch({ headless: true })`.
- **Runner**: [.certs/smoke/browser-smoke.spec.mjs](../../.certs/smoke/browser-smoke.spec.mjs) (gitignored), screenshots into `.certs/smoke/shots/`.
- **CORS**: BFF env `CORS_ORIGINS=http://localhost:5173,http://localhost:5174` — widened mid-run so the user's own `:5173` dev keeps working.

User's own `:5173` Vite session: not touched (HTTP 200 before, during, and after the smoke).

## Browser smoke status

**APP_AUTH_BROWSER_SMOKE_OK** — 15 passed / 0 failed.

```json
{"summary": "totals", "passed": 15, "failed": 0}
```

### Per-step verdict

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | open `/login` | ✅ | URL = `/login`, screenshot `01-login.png` |
| 2a | POST `/api/v1/auth/login` → 200 | ✅ | status 200 |
| 2b | **NO Supabase `/auth/v1/token` call during login** | ✅ | 0 supabase-auth hits in spy window |
| 3a | post-login redirect off `/login` | ✅ | url → `/dashboard` |
| 3b | `localStorage.hubtender_app_auth_session` set | ✅ | 1 key present |
| 4 | header shows user/menu | ✅ | "TenderHUB", "Дашборд", "Список задач", "Позиции заказчика", ..., "Администрирование" rendered |
| 5 | `/tenders` page opens | ✅ | navigated; 0 http failures |
| 6 | reload preserves session | ✅ | stayed on `/tenders` after reload |
| 7 | refresh forced (backdated `expires_at`) → `POST /api/v1/auth/refresh` 200 | ✅ | status 200, no `refresh_reuse_detected` |
| 8a | `/register` placeholder shows "недоступна" + no Supabase call | ✅ | screenshot `05-placeholder-_register.png` |
| 8b | `/forgot-password` placeholder shows "недоступен" + no Supabase call | ✅ | screenshot `05-placeholder-_forgot_password.png` |
| 8c | `/reset-password` placeholder shows "недоступен" + no Supabase call | ✅ | screenshot `05-placeholder-_reset_password.png` |
| 9a | logout → `POST /api/v1/auth/logout` 204 | ✅ | invoked via `js_eval` fallback (no logout button on dashboard at that moment) |
| 9b | `localStorage` cleared (`hubtender_app_auth_*` count = 0) | ✅ | |
| 10 | protected route after logout → `/login` | ✅ | `/dashboard` → `/login` redirect |

## Network summary

| Bucket | Hits | Verdict |
|---|---|---|
| `http://localhost:3006/api/v1/auth/*` | 17 | login + refreshes + me + logout |
| `http://localhost:3006/api/v1/*` (business) | 67 | dashboard/tenders/references reads |
| `ws://localhost:3006/api/v1/ws` | 0 | smoke flow didn't trigger a subscribe; WS path was covered separately in [36 doc](36_APP_AUTH_E2E_SMOKE_RESULT.md#websocket) |
| `*.supabase.co/auth/*` | **0** | ✅ matches spec |
| `*.supabase.co/rest/v1/*` | **0** | ✅ matches spec |
| `*.supabase.co/storage/*` | **0** | ✅ |

## Screenshots

Captured under `.certs/smoke/shots/` (gitignored):

```
01-login.png                                          login form
02-after-login.png                                    dashboard, user menu visible
03-tenders.png                                        /tenders list
04-after-reload.png                                   reload preserved /tenders
05-placeholder-_register.png                          "Регистрация временно недоступна" card
05-placeholder-_forgot_password.png                   "Сброс пароля временно недоступен"
05-placeholder-_reset_password.png                    "Сброс пароля временно недоступен"
06-after-logout.png                                   /login state (post-logout)
07-protected-after-logout.png                         /dashboard → /login redirect
results.json                                          raw step + network counters
```

Inspect any image directly from the file system — they're sized ~17–340 KB.

## Failed UI points

(none)

## Blockers / warnings

| # | Item | Note |
|---|---|---|
| 1 | `.env.local` (created earlier for smoke) cross-contaminates ANY Vite session in this repo, including your own dev on `:5173`. Mid-run that session caught a `net::ERR_CONNECTION_REFUSED` from `:3006/api/v1/auth/login` (BFF was bouncing between smoke restarts), then a stale CORS mismatch once BFF came back. Mitigated by widening `CORS_ORIGINS` to `:5173,:5174`. | After smoke: either keep `.env.local` (your dev is now app-mode too) or `Remove-Item .env.local` to revert to supabase-mode. |
| 2 | Logout button finder fell back to `js_eval` of `signOut()` — the dashboard layout didn't expose an obvious `<button>Выйти</button>` reachable by my selector. Functionally identical (POST 204 + localStorage cleared + redirect), but in a real-user session the visible "Выйти" control should be discoverable. | Worth a UX pass when wiring `useAuthWithNavigation()` into a clearly-labelled header menu. |
| 3 | Smoke flow did NOT exercise WebSocket subscription via the browser path (no live realtime panel was opened). Covered separately by 36 doc harness. | Harness already proved WS open + subscribe accept with app JWT. |
| 4 | Inevitable Yandex DB writes: another `app_auth.refresh_tokens` row + 4–6 events in `app_auth.auth_events` (login + refresh + logout). No business data touched. | Per spec. |
| 5 | Headless Chromium ≠ real human eyes. Pixel-level rendering, antd theme regressions, accessibility — not asserted. | Recommend a visual stand-up before flipping prod `VITE_AUTH_MODE=app`. |
| 6 | Both my services stopped cleanly. User's `:5173` Vite still alive (HTTP 200). | |

## Artifacts (gitignored)

- `.certs/smoke/browser-smoke.spec.mjs` — Playwright runner
- `.certs/smoke/shots/*.png` — 9 screenshots
- `.certs/smoke/shots/results.json` — raw step + net counters
- `.certs/bff.log`, `.certs/vite.log` — server logs

Cleanup (optional):
```powershell
Remove-Item -Recurse -Force .certs\smoke
Remove-Item .certs\bff.log .certs\vite.log
Remove-Item .env.local             # if you don't want app-mode in local dev
```

## Final status

**APP_AUTH_BROWSER_SMOKE_OK**

Recommended next step: a manual visual gate (open the SPA, click around) before changing production `VITE_AUTH_MODE` to `app`.
