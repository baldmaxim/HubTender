# 39 — Tender Detail 500 Fix Result

> P1 follow-up to [38_APP_AUTH_CUTOVER_RESULT.md](38_APP_AUTH_CUTOVER_RESULT.md):
> `GET /api/v1/tenders/{id}` returned 500 in production. Root cause —
> schema drift between Go BFF query and Yandex `public.tenders` (column
> `area` does not exist on Yandex). Fixed at the repository layer; no
> auth / DB / production env changes. Not deployed.

## Final status

**TENDER_DETAIL_500_FIX_OK**

## Root cause

`backend/internal/repository/fi.go:GetTenderByID` selected:

```sql
SELECT id::text, COALESCE(title, ''),
       tender_number, client_name, version, is_archived,
       usd_rate, eur_rate, cny_rate,
       markup_tactic_id::text, cached_grand_total,
       housing_class::text, construction_scope::text,
       area, area_sp, area_client                          -- ← `area` doesn't exist
FROM public.tenders
WHERE id = $1
```

Yandex `public.tenders` columns include `area_sp numeric` and `area_client numeric`
but **NOT** `area`. PostgreSQL returned `ERROR: column "area" does not exist`
(SQLSTATE `42703`), which `fi.go` wrapped into `fmt.Errorf("fiRepo.GetTenderByID: %w", ...)`,
which the handler in turn rendered as a generic
`{"detail":"failed to load tender","status":500}` — making the inner cause
invisible from the frontend.

This was a **pre-existing bug** (recorded in [36_APP_AUTH_E2E_SMOKE_RESULT.md](36_APP_AUTH_E2E_SMOKE_RESULT.md)),
NOT a Phase 6 auth-cutover regression. The endpoint was simply unreachable
until the cutover put the FI page back into real user navigation.

### Why `area` is missing on Yandex

- Yandex `public.tenders` columns (`information_schema.columns`):
  `id, title, description, client_name, tender_number, submission_deadline, version, area_client, area_sp, usd_rate, eur_rate, cny_rate, upload_folder, bsm_link, tz_link, qa_form_link, created_at, updated_at, created_by, markup_tactic_id, apply_subcontract_works_growth, apply_subcontract_materials_growth, housing_class, construction_scope, project_folder_link, is_archived, volume_title, cached_grand_total`.
- "Общая площадь объекта" (the value the frontend reads as `tender.area`)
  lives on **`public.tender_registry.area`** (numeric) on Yandex.
- During the 2026-05 DB cutover the per-tender `area` column was lifted to
  the registry level (kept `area_sp` and `area_client` per-tender for SP /
  client variants). The Go BFF struct + SQL were not updated to match.

## Affected endpoint

| Endpoint | Before | After |
|---|---|---|
| `GET /api/v1/tenders/{id}` | **500 `"failed to load tender"`** | **200** with body `{data:{id, title, tender_number, client_name, version, is_archived, usd_rate, eur_rate, cny_rate, markup_tactic_id, cached_grand_total, housing_class, construction_scope, area_sp, area_client}}` |

Verified locally against Yandex on 5 distinct tender ids (all returned 200,
including the previously-failing `e8c3a228-…`).

## Changed files

- [backend/internal/repository/fi.go](../../backend/internal/repository/fi.go)
  — diff: `+27 / −19`.
  - `FITenderRow.Area *float64` field removed.
  - SQL `SELECT` reduced to `area_sp, area_client` (no `area`).
  - `Scan` argument list updated to match.
  - Doc-comment on `FITenderRow` explains the schema drift + the
    forward path (teach FI page to join `tender_registry` by
    `tender_number`).

No other files touched. No auth-flow, DB schema, frontend, env, deploy,
push changes.

## Frontend impact

`tender.area` will be `undefined` in the FI tender payload going forward.
Frontend consumers already handle this gracefully (`tender.area ? ... : '-'`
in `TenderDrawer`, `TenderDrawerModern`, `TenderGridRow`, `TenderMonitorModal`,
`TenderMonitorTable`). UX behaviour:
- "Площадь" / "Площадь по СП" cells render '-' instead of a number.
- "Цена ₽/м²" cards skip the per-square divisor.

`area_sp` and `area_client` ARE returned (they exist on `tenders`), so
the SP/client area columns continue to work. The `EditableMonitorField`
that lets users update `field="area"` from `TenderMonitorModal` still
posts to a write handler — that write path is OUT OF SCOPE here (was
broken in the same way before the fix; see Follow-ups).

## Test / smoke result

| Check | Result |
|---|---|
| `gofmt -l backend/internal/repository/fi.go` | ✅ clean |
| `go test ./internal/handlers ./internal/repository ./internal/services` | ✅ all OK (no test files in handlers/repository — services cached pass) |
| `go test ./...` | ✅ everything except `internal/calc/markup_test.go` (3 pre-existing float/domain failures — same as 36/32 docs) |
| `go build ./cmd/server` | ✅ |
| `npm run typecheck` | ✅ |
| Local smoke against Yandex: `GET /api/v1/tenders/<id>` for 5 ids | ✅ all 200 |
| BOQ-items-flat sibling endpoint (same FI repo) | ✅ 200 (unaffected) |

### Reproduction

For future debugging:
```bash
# Bring BFF up on :3006 against Yandex (see .certs/bff-launch.env)
set -a && source .certs/bff-launch.env && set +a && ./backend/hubtender-bff.exe &

# Login + capture token
node .certs/smoke/smoke.mjs login

T=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('.certs/smoke/app.json','utf8')).access_token)")
curl -sS -H "Authorization: Bearer $T" \
  http://localhost:3006/api/v1/tenders/<any-id> -w "\nHTTP %{http_code}\n"
```

Direct DB reproduction (without BFF) using `pg`:
```js
await client.query(`SELECT area FROM public.tenders LIMIT 1`);
// → ERROR: column "area" does not exist (SQLSTATE 42703)
```

## Production deploy recommendation

Strongly recommended — this restores the tender-detail page that's currently
broken in prod. Deploy mechanism unchanged ([38 doc](38_APP_AUTH_CUTOVER_RESULT.md) §Rollback path):

```bash
# After git push origin main:
bash scripts/deploy-production.sh backend
# Verifies docker rebuild + systemctl restart + /health 200.
```

Frontend redeploy is NOT required (no frontend code touched in this PR).

## Production deploy result (post-deploy update)

**Deployed**: 2026-05-23, release `hubtender-api@7f543ef`.

Operator-driven deploy log highlights:
- `git fetch origin main`: `74f399a..7f543ef` ✓
- `bash scripts/deploy-server.sh --check`: preflight OK (hostname=hub, env files present, docker 29.1.3, node v22.22.2, rsync)
- `docker build -t hubtender-api:prod ./backend`: OK (`Successfully built 3059fc896abf`)
- `systemctl restart hubtender-bff.service`: OK
- New BFF log lines:
  - `sentry initialised env=production release=hubtender-api@7f543ef`
  - `app JWT issuer ready kid=gpJuRL85-…`
  - `port=3005 server listening`
- `GET http://127.0.0.1:3006/health` → 200 `{"status":"ok"}`
- `GET http://127.0.0.1:3006/health/db` → 200 `{"status":"ok"}`

### Post-deploy public smoke (read-only)

```
POST /api/v1/auth/login                       → 200 (Bearer JWT, user dev/approved)
GET  /api/v1/tenders?limit=5                  → 200 (5 tenders)
GET  /api/v1/tenders/<id-1..5>                → 5/5 × 200
GET  /api/v1/tenders/e8c3a228-…               → 200
     body: {title:"Событие 6.1", area_sp:67106, area_client:67106.03,
            housing_class:"бизнес", construction_scope:"генподряд", …}
     'area' field absent (as designed)
```

**Production smoke: OK.** Endpoint восстановлен на проде, фронт получает
ожидаемый payload, `area_sp`/`area_client` присутствуют, `area` отсутствует
(graceful на фронте).

## Rollback note

If the fix introduces a regression (very unlikely — strictly removes a
column read), revert `backend/internal/repository/fi.go` to its pre-fix
state via `git revert <commit>` + redeploy backend. **Prod will instantly
return to the previous 500 on tender-detail**, so rollback is only useful
if the fix breaks something ELSE on the FI page.

`app_auth.*` tables and DB schema are NOT touched by this PR — nothing to
roll back at the DB layer.

## Follow-ups (separate PRs)

| # | Item | Severity |
|---|---|---|
| F1 | `GET /api/v1/tenders/{id}/positions` returns 500 (different repository, different root cause). Handler logs the inner error to `apierr.InternalError` and discards it — improved observability needed first. | P2 |
| F2 | `GET /api/v1/tenders/{id}/overview` timed out in my local smoke (>5 s). May be a heavy query / N+1 on this specific tender. | P2 |
| F3 | Teach FI page (or BFF endpoint) to join `tender_registry.area` by `tender_number` so the frontend's "Площадь" column gets a real value again. | P3 |
| F4 | Improve error logging: include the inner `err` text in the request-log record so future schema-drift bugs surface immediately. The current pattern (`apierr.InternalError("failed to X")` + middleware logging only HTTP status) masks every `error`-level cause. | P2 |
| F5 | Add a repository-level smoke test that runs the FI SQL against a known-good schema (Yandex `prod.sql`) to catch drift in CI. | P3 |

## What was NOT done (per spec)

- ❌ frontend code untouched
- ❌ DB schema untouched (no migration)
- ❌ DATABASE_URL untouched
- ❌ import / clean / repair not run
- ❌ no deploy
- ❌ no push
- ❌ no auth-flow changes
- ❌ no Supabase changes
