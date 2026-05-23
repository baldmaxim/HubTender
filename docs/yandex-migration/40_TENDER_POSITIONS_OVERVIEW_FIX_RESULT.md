# 40 — Tender Positions + Overview Fix Result

> Follow-up to [39_TENDER_DETAIL_500_FIX_RESULT.md](39_TENDER_DETAIL_500_FIX_RESULT.md).
> Two more 500s/timeouts on the tender-detail page surfaced after F39
> deploy: `GET /api/v1/tenders/{id}/positions` (500, numeric→int scan
> failure) and `GET /api/v1/tenders/{id}/overview` (8 s+ timeout,
> Cartesian COUNT-DISTINCT). Diagnosed by adding observability helper,
> fixed at the repository layer, verified locally against Yandex. Not
> deployed. No auth / DB / production env changes.

## Final status

**TENDER_POSITIONS_OVERVIEW_FIX_OK**

## Root cause F1 — `GET /api/v1/tenders/{id}/positions` → 500

`backend/internal/repository/position.go:ListPositions` declared
`PositionRow.PositionNumber int`, but `public.client_positions.position_number`
is **`numeric`** in Yandex schema. ~0.7 % of real rows have a fractional
value (`4.10`, `794.10`, `1099.10`, `890.30`, `192.30` etc.) — used as a
dotted hierarchy notation by the BOQ builder.

pgx surfaced this as:
```
positionService.ListPositions: positionRepo.ListPositions: scan:
can't scan into dest[2]: cannot convert &{1910 -2 false finite true} to integer
```
(`&{1910 -2 false finite true}` = pgtype.Numeric `Int=1910, Exp=-2` → 19.10)

For `e8c3a228…`: 1181 positions, **9 fractional** (queried directly).
Globally: 301 fractional out of 46033. Any tender with at least one
fractional position 500'd on `/positions`.

## Root cause F2 — `GET /api/v1/tenders/{id}/overview` → timeout

`backend/internal/repository/tender.go:GetTenderOverview` ran a single
query joining three tables with `COUNT(DISTINCT)` for position + boq-item
counts:

```sql
SELECT t.*, COUNT(DISTINCT cp.id), COUNT(DISTINCT bi.id)
FROM tenders t
LEFT JOIN client_positions cp ON cp.tender_id = t.id
LEFT JOIN boq_items        bi ON bi.tender_id = t.id
WHERE t.id = $1
GROUP BY t.id;
```

For `e8c3a228…` (1181 cp × 5362 bi = **6 332 522** intermediate rows),
the plan was a Nested Loop Left Join → Sort (`Disk: 359 432 kB`
external merge) → GroupAggregate → COUNT DISTINCT. `EXPLAIN ANALYZE`:
**execution time 12 929 ms**. Curl with 5–8 s timeout cancelled the request;
BFF saw client disconnect and surfaced `context canceled` from
`tenderRepo.GetTenderOverview: scan: context canceled`.

## Changed files

| File | Purpose | Δ |
|---|---|---|
| [`backend/pkg/apierr/internal_log.go`](../../backend/pkg/apierr/internal_log.go) | **NEW** helper `apierr.InternalFromErr(w, r, err, detail, kv...)` — logs inner err + method/path/request_id/kv pairs at ERROR level, then renders the same RFC 7807 500 problem+json. Caller-safe (`err` never leaks to the client). | +40 |
| [`backend/internal/handlers/positions.go`](../../backend/internal/handlers/positions.go) | `GetPositions` now uses `InternalFromErr` with `tender_id` context. | +1/-1 |
| [`backend/internal/handlers/tenders.go`](../../backend/internal/handlers/tenders.go) | `GetTenderOverview` now uses `InternalFromErr` with `tender_id` context. | +1/-1 |
| [`backend/internal/repository/position.go`](../../backend/internal/repository/position.go) | `PositionRow.PositionNumber int → float64`. Doc-comment explains why (hierarchical fractional numbering). | +9/-1 |
| [`backend/internal/repository/tender.go`](../../backend/internal/repository/tender.go) | `GetTenderOverview` SQL: LEFT JOIN + COUNT(DISTINCT) + GROUP BY → two scalar subqueries hitting `idx_client_positions_tender_id` and `idx_boq_items_tender_id`. Doc-comment carries the EXPLAIN numbers. | +12/-5 |

No frontend, env, DB schema, deploy, push changes.

`apierr.InternalFromErr` is rolled out only to the two handlers I touched
this PR. Other `apierr.InternalError("...").Render(w)` call-sites (40+
across the handlers package) still swallow inner err — separate
observability rollout, see Follow-ups.

## Smoke results (local BFF :3006 → Yandex)

```
=== F1 POST-FIX: /positions ===
HTTP 200
positions returned: 50 ; sample numbers: [11, 3, 19.1, 14, 13]
                               ← '19.1' confirms the float64 scan works

=== F2 POST-FIX: /overview ===
HTTP 200  elapsed=285ms
body: {position_count: 1181, boq_item_count: 5362, ...}
                               ← was 12 929 ms; ~45× speedup

=== Sanity: original GET /tenders/{id} still works ===
HTTP 200

=== BFF log tail (any internal-error events?) ===
(no errors)
```

## Test / build / typecheck

| Check | Result |
|---|---|
| `gofmt -l` (5 changed files) | ✅ clean |
| `go test ./internal/handlers ./internal/repository ./internal/services` | ✅ |
| `go test ./...` | ✅ except 3 pre-existing `internal/calc/markup_test.go` failures (same as 36/39 docs) |
| `go build ./cmd/server` | ✅ |
| `npm run typecheck` | ✅ |

JSON-contract check: `position_number` going from Go `int` to `float64`
serializes identically in JSON for integer values (`1` not `1.0` — Go's
`encoding/json` uses `strconv.FormatFloat(... -1, ...)` which omits
trailing zeros). Fractional values now actually serialize as `19.1`
instead of failing the scan. Frontend TS type is `number | null` — no
breakage.

## Deploy recommendation

Strongly recommended. Backend-only deploy (frontend unchanged):

```bash
# After git push origin main:
bash scripts/deploy-production.sh backend
```

Expected post-deploy smoke (operator-driven):
- Open tender `e8c3a228-…` in browser → page renders without 500.
- DevTools Network: `/api/v1/tenders/{id}/positions` → 200, `/overview` → 200 (< 500 ms typical).
- Other tender ids should also work (fix is general).

## Rollback note

Both fixes are isolated:
- F1 revert: restore `PositionNumber int` in `PositionRow`. Will re-introduce 500 for fractional-numbered positions. Safe to revert.
- F2 revert: restore the COUNT(DISTINCT) query. Will re-introduce 12 s+ execution for large tenders. Safe to revert.

`apierr.InternalFromErr` is additive (new helper), the two updated
handler call-sites still produce the same 500 problem+json — revert
would only remove server-side error log lines.

`app_auth.*` and DB schema NOT touched.

## Follow-ups (separate PRs)

| # | Item | Severity |
|---|---|---|
| F4 (from 39 doc) | Roll `apierr.InternalFromErr` to all remaining `apierr.InternalError("...").Render(w)` call-sites (~40 handlers). Big mechanical PR; would surface every future schema-drift / pgx bug in the request log instantly. | P2 |
| F5 (from 39 doc) | Repo smoke test against `prod.sql` to catch schema drift in CI. | P3 |
| F6 (new) | Audit other repository scan structs for `int`-typed columns that the DB actually stores as `numeric`. Suspects worth grepping: `version`, `hierarchy_level`, `position_number` (now fixed). | P3 |
| F7 (new) | Other "summary" / "stats" SQL queries may have the same Cartesian-COUNT-DISTINCT pattern. Worth a one-pass review of every `GROUP BY t.id` + `COUNT(DISTINCT *)` combo. | P3 |
| F8 (new) | Tender-detail page has multiple eager loads on mount — consider client-side deferral / suspense so overview-style queries don't block first paint. | P3 (frontend) |
| F3 (from 39 doc) | Teach FI page to join `tender_registry.area` so the frontend's "Площадь" column gets a value. | P3 |

## What was NOT done (per spec)

- ❌ frontend code untouched
- ❌ DB schema / data untouched
- ❌ DATABASE_URL / AUTH_MODE / production env untouched
- ❌ import / clean / repair not run
- ❌ no deploy
- ❌ no push
- ❌ no auth-flow changes
