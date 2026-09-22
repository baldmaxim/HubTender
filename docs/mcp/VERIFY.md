# Verification and acceptance gates

Every command must pass on the colleague's final checkout.

## Static/build gates

```bash
cd backend
go vet ./...
go test -p 1 ./...
go build ./cmd/server
cd ..
npm ci
npm run lint
npm run typecheck
VITE_API_URL=https://staging.example npm run build
```

Run `scripts/mcp/preflight.ps1` on Windows or `scripts/mcp/preflight.sh` on
Linux before and after applying the patch.

## Database gates

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/mcp/verify_migration.sql
```

Expected: one row ending in `MCP_MIGRATION_OK`. No production data is changed.

## HTTP/MCP gates

1. Run `scripts/mcp/smoke.ps1 -BaseUrl https://staging.example` without a token.
   Discovery must be public and `/mcp` must return 401 with `WWW-Authenticate`.
2. Complete OAuth in the browser and rerun with `-AccessToken`.
3. `server/discover` and `tools/list` must return JSON-RPC results.
4. Confirm 18 tools, every tool has input/output schema and annotations.
5. Revoke the grant in `/settings/agents`; the same access token must receive
   401 immediately.

## Pricing UAT

- Exact archived item: rate/currency/source date and quote link are preserved.
- USD/EUR/CNY source: target total uses the target tender FX; source historical
  RUB is display evidence only.
- Press-compactor search never returns `Монтаж мебели` as an eligible match.
- A source older than 180 days and a >50% median outlier are visibly warned.
- Unit mismatch and missing target FX block validation.
- Changing an item after validation makes apply fail as stale.
- Applying twice returns the same result and creates no duplicate BOQ rows.
- A multi-operation failure rolls back every BOQ/audit/provenance write.
- Engineer receives 403 for shared template mutations; leading engineer,
  administrator, and developer can proceed only after elicited confirmation.
- QA direct total equals a fresh TenderHUB reread; every applied row has an
  append-only `boq_item_pricing_sources` record.

## Performance targets

On a production-like staging snapshot:

- archive search p95 <= 2 seconds;
- pricing state p95 <= 3 seconds;
- a normal validated draft apply <= 30 seconds.

For a disposable benchmark DB, apply `evaluation_fixture.sql` and
`performance_fixture.sql`, then run the integration performance test with
`RUN_MCP_PERF_TESTS=1`. Remove both fixtures afterward; never seed production.

Do not deploy when any gate is red. Record commands, timestamps, commit SHA,
migration checksum, and actual results in the handoff verification report.
