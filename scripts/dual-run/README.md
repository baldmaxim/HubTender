# Dual-run verification scripts

Before enabling any Go BFF feature flag in production, run the corresponding
dual-run script against representative tenders. Every script:

1. Calls the original Supabase RPC (or `.from()` query) via service role.
2. Calls the ported Go BFF endpoint via a regular user JWT.
3. Diffs the responses row-by-row with a tolerance of **0.01 RUB** on
   numeric fields; ignores `created_at`/`updated_at` drift.
4. Exits `0` on full match, `1` on any mismatch.

## Setup

Add to `.env`:

```
SUPABASE_URL=https://ocauafggjrqvopxjihas.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
VITE_SUPABASE_PUBLISHABLE_KEY=<anon>
VITE_API_URL=http://localhost:8080
DUAL_RUN_EMAIL=<test-user-email>
DUAL_RUN_PASSWORD=<test-user-password>
```

The test user needs read access to the tenders you pass in.

## Scripts

| Script | Endpoint | Supabase source |
|---|---|---|
| [positions-with-costs.mjs](./positions-with-costs.mjs) | `GET /api/v1/tenders/:id/positions/with-costs` | `get_positions_with_costs` RPC |

## Usage

```bash
node scripts/dual-run/positions-with-costs.mjs <tender-id> [<tender-id> ...]
```

Representative set — 20 tender IDs across housing classes and BOQ sizes —
lives in `docs/dual_run_tenders.md` (to be created). Run full set before
each domain cutover and save the output to `docs/dual_run_results/<domain>_<YYYY-MM-DD>.md`.

## Adding new scripts

Use [positions-with-costs.mjs](./positions-with-costs.mjs) as a template:
1. `fetchSupabase()` — call the RPC or SELECT with service-role client.
2. `fetchGo()` — call the Go endpoint with a user JWT.
3. `diffRow()` — compare with `NUMERIC_FIELDS` tolerance.
4. `runOne()` — report per-tender OK/FAIL.

Cover at minimum: `bulk_update_boq_items_commercial_costs`,
`bulk_import_client_position_boq`, `execute_version_transfer`.
