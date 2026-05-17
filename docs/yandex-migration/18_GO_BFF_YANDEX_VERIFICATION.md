# 18. GO BFF ↔ YANDEX VERIFICATION

> Verification only — **NOT a production cutover**. Production `DATABASE_URL` /
> backend / frontend deployment were NOT changed. No import/clean/repair, no DB
> writes, no write-smoke-tests, OLD untouched. DSN/tokens/passwords/keys never
> printed.

- Verified (UTC): 2026-05-18
- Yandex Managed PostgreSQL connection-manager mode: **session** (switched
  transaction → session); cluster **Alive**. `YANDEX_DIRECT_DATABASE_URL` =
  `YANDEX_DATABASE_URL` (session-mode pooler).
- Auth model (temporary bridge): backend validates **Supabase JWT/JWKS**
  (`ocauafggjrqvopxjihas`); DB → Yandex.

## Launch method

Go BFF launched locally with `DATABASE_URL = YANDEX_DATABASE_URL` (session-mode
pooler), `SUPABASE_JWKS_URL=https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json`,
`SUPABASE_JWT_ISSUER=https://ocauafggjrqvopxjihas.supabase.co/auth/v1`. Backend
has no separate realtime-DSN env — the single `DATABASE_URL` is correct now
that the pooler is session-mode. Temporary process; port 3005 freed afterwards.

## Health

| Check | Result |
|---|---|
| `GET /health` | ✓ 200 |
| `GET /health/db` | ✓ 200 — BFF reached Yandex DB |

## Auth (Supabase JWT bridge)

| Check | Result |
|---|---|
| JWT via PROD Supabase Auth (`PROD_SUPABASE_ANON_KEY`) | ✓ token obtained (never printed) |
| `GET /api/v1/me` (with JWT) | ✓ 200 |
| `GET /api/v1/me/permissions` | ✓ 200 — 20 pages |

## Endpoints (Yandex-backed)

| Endpoint | Result |
|---|---|
| `GET /api/v1/references/roles` | ✓ 200 — 9 rows |
| `GET /api/v1/references/units` | ✓ 200 — 8931 rows |
| `GET /api/v1/references/material-names` | ✓ 200 — 6591 rows |
| `GET /api/v1/references/work-names` | ✓ 200 — 2340 rows |
| `GET /api/v1/references/cost-categories` | ✓ 200 — 24 rows |
| `GET /api/v1/references/detail-cost-categories` | ✓ 200 — 218 rows |
| `GET /api/v1/tenders?limit=5` | ✓ 200 — 5 rows |

## Realtime

| Check | Result |
|---|---|
| Realtime listener connect | ✓ connected; listening on channel `rowchange` |
| Manual `NOTIFY rowchange` in Yandex received by BFF | ✓ notification received; broker published `tender:*` and `tenders` |
| Session-mode pooler accepts `LISTEN/NOTIFY` | ✓ confirmed end-to-end (no transaction-pooler breakage) |

`public.notify_row_change()` + the 6 `trg_notify_row_change_*` triggers
(`tenders`, `notifications`, `boq_items`, `client_positions`,
`cost_redistribution_results`, `construction_cost_volumes`) are present and
exercised. The prior realtime production blocker is **cleared**.

## Status notes (important)

- **Runtime cutover is NOT done.** Production `DATABASE_URL` still points at
  PROD Supabase; backend/frontend deployment unchanged. This run only proves
  the Go BFF works correctly against Yandex.
- **Production CA path must be configured separately.** The local smoke
  downloaded the Yandex CA to a temporary path (the `sslrootcert` path from env
  did not exist on the test Mac). The production deployment needs a **stable,
  managed Yandex CA path** (mounted/secret-managed), not a temp file. A
  per-project copy is available at `.certs/yandex-ca.pem` for local use; the
  deployment environment must supply its own stable path.
- **Auth model is still Supabase Auth JWT + Go BFF + Yandex DB** (temporary
  bridge): login/JWT issued by PROD Supabase Auth, validated by the BFF via
  Supabase JWKS; only the database is Yandex.
- **Full removal of Supabase Auth is a separate later stage** (app-auth in Go:
  own login/JWT issuer/JWKS, `app_auth` password store) — out of scope here.

## Blockers

- _none for Go BFF ↔ Yandex verification._
- Pending for the final runtime cutover (separate, gated prompt): production
  `DATABASE_URL` switch + stable production Yandex CA path + (later) app-auth.

## Warnings

- ⚠ `npm run yandex:preflight` may still warn about
  `YANDEX_DIRECT_DATABASE_URL` — env-file scoping only (preflight reads its own
  env file); LISTEN/NOTIFY verified working end-to-end here.
- ⚠ Production Yandex CA path must be made stable before cutover (temp path
  used only for this local verification).

## Final status

```
GO_BFF_YANDEX_VERIFY_OK
```

> Go BFF verified end-to-end against Yandex: health, DB, Supabase-JWT auth,
> references, tenders, and realtime `LISTEN/NOTIFY` (`rowchange`) all OK. All
> migration gates remain green: `DATA_IMPORT_OK`, `YANDEX_VERIFY_OK`,
> `YANDEX_AUTH_VERIFY_OK`, `TENDERS_UPDATED_AT_REPAIR_OK`, `SCHEMA_VERIFY_OK`.
> This is verification only — the production runtime cutover (DATABASE_URL /
> stable CA path / future app-auth) is a separate authorised step and was NOT
> performed.
