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

---

## Re-verification 2026-05-20 (post-refresh)

After today's full OLD → PROD → Yandex data refresh, the Go BFF was re-verified
against the freshly-imported Yandex cluster.

- Launch method: local Go binary built from current `backend/` HEAD
  (`713607a`), launched with `DATABASE_URL=<YANDEX_DATABASE_URL session-pooler>`,
  `SUPABASE_JWKS_URL` / `SUPABASE_JWT_ISSUER` pointing to PROD Supabase
  (`ocauafggjrqvopxjihas`), bound to `127.0.0.1:3105`. Temporary process; port
  freed afterwards. `JWT_CLOCK_SKEW_SECONDS=15` applied to absorb local clock
  drift on Windows (transient — not a code defect).
- Yandex DSN / Yandex SSL root cert sourced from
  `scripts/prod-to-yandex/.env.prod-to-yandex`; values never printed.

### Smoke harness — all 22 checks passed

| Block | Result |
|---|---|
| `GET /health` | ✓ 200 |
| `GET /health/db` (Yandex ping) | ✓ 200 |
| 401-expected: `/api/v1/me`, `/api/v1/references/units`, `/api/v1/tenders`, `/api/v1/ws`, `POST /api/v1/redistributions/save` | ✓ all 401 |
| Sign-in via Supabase Auth (`PROD_SUPABASE`) | ✓ JWT obtained |
| `GET /api/v1/me` | ✓ 200 — shape ok (full_name + allowed_pages present, matches Phase 5 contract) |
| `GET /api/v1/me/permissions` | ✓ 200 — allowed_pages array present |
| `GET /api/v1/references/{roles,units,material-names,work-names,cost-categories,detail-cost-categories}` | ✓ 200 × 6 — `data` arrays |
| `GET /api/v1/tenders?limit=5` | ✓ 200 — `data` array (49 tenders backed by Yandex) |
| `GET /api/v1/tender-registry` | ✓ 200 — 69 rows |
| `GET /api/v1/tender-statuses`, `/api/v1/construction-scopes` | ✓ 200 × 2 |
| `GET /api/v1/tender-registry/{next-sort-order,autocomplete,tender-numbers}` | ✓ 200 × 3 |

### Realtime

`LISTEN/NOTIFY` listener connected at startup against Yandex
(`listener: connected; listening on channel 'rowchange'`).

### Notes

- Initial smoke run failed with `token has invalid claims: token used before
  issued` because the local Windows clock was a few seconds behind Supabase
  Auth's `iat`. Resolved by setting `JWT_CLOCK_SKEW_SECONDS=15` for this
  verification process. In production this knob is unset (strict) — the
  finding is local-clock-only, not a backend regression.
- Smoke harness uses `MIGRATION_SMOKE_*` creds from
  `scripts/old-to-prod/.env.old-to-prod` (preserved from OLD → PROD verify).
- Go BFF process was stopped and the temporary binary removed after
  verification. Port 3105 freed. `.env` not modified.

```
GO_BFF_YANDEX_VERIFY_OK (2026-05-20)
```
