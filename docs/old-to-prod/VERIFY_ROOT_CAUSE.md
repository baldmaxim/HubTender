# VERIFY_FAILED — root cause (final strict cutover, OLD frozen)

> 2026-05-16. Read-only diagnosis via Supabase MCP. No data changed.
> Supersedes the live-writes hypothesis in `REHEARSAL_VERIFICATION_DECISION.md`
> §7 — that was **wrong**. OLD was frozen this run; mismatch still occurred.

## Status: **VERIFY_FAILED** — genuine pipeline defect (not benign)

- `VERIFY_RESULT.md` = `VERIFY_FAILED` — checksum mismatch on
  `public.client_positions` and `public.projects`.
- `AUTH_VERIFY_RESULT.md` = `AUTH_VERIFY_OK` (users 33=33, identities
  4+29=33, passwords match=33, null-token total=0, smoke login OK).
- Row counts match, `duplicate_pk_total=0`, `boq_items_audit` inflation=0,
  `tender_registry` duplicates unchanged.

## Root cause: node-postgres parses date/timestamptz into JS `Date`

The export client (`pg`) has **no type-parser override** (grep:
no `setTypeParser` anywhere in `scripts/old-to-prod`). Default parsers:

| OID | type | default parser | effect on export host (non-UTC TZ) |
|----|------|----------------|-------------------------------------|
| 1082 | `date` | JS `Date` @ **local midnight** | `.toISOString()` → UTC → **−1 day** |
| 1184 | `timestamptz` | JS `Date` (ms resolution) | microseconds **truncated** (`.309186`→`.309`) |

Evidence (`public.projects`, 12 rows, OLD frozen):

| column | OLD | PROD | delta |
|--------|-----|------|-------|
| construction_end_date | `2028-02-28` | `2028-02-27` | **−1 day** |
| contract_date | `2025-04-25` | `2025-04-24` | **−1 day** |
| created_at | `…36.309186+00` | `…36.309+00` | µs lost |
| updated_at | `…17.796468+00` | `…17.796+00` | µs lost |

**Every** `date` value shifted back exactly one day; **every**
`timestamptz` lost sub-millisecond precision. Deterministic, dataset-wide.
`client_positions`/`projects` are simply the `CHECKSUM_TABLES` members
whose columns expose it.

This is **data corruption introduced by the migration pipeline**, not a
text-render artifact and not source drift. NOT acceptable for cutover.

## Affected columns (confirmed)

- `public.projects.construction_end_date`, `public.projects.contract_date`
  (`date`) — every value shifted **−1 day**.
- `public.projects.created_at` / `updated_at` and all `timestamptz` —
  **microseconds truncated** (`.309186`→`.309`).
- `public.client_positions` temporal columns — same class (it is the other
  `CHECKSUM_TABLES` member exposing the defect).

## Fix — IMPLEMENTED (re-cutover pending operator confirmation)

`scripts/old-to-prod/_lib.mjs`:

- `installPgRawTemporalParsers()` — process-wide raw-text parsers for
  `DATE`/`TIMESTAMP`/`TIMESTAMPTZ` (builtins, OID fallback 1082/1114/1184).
  Called by `getClient()` before any `pg.Client` is constructed.
- `getClient()` now also pins a deterministic session after connect:
  `SET TIME ZONE 'UTC'` + `SET DateStyle = 'ISO, MDY'`. SET failure ⇒
  connection torn down + throw (fail-fast).
- `assertTemporalRawParsers(client)` — fail-fast self-check; export
  (`04`, both modes) and verify (`07`) abort if pg still yields JS Date /
  lossy values. Result recorded in `export_validation.json`
  (`temporal_parser_check`) and `manifest.json`
  (`temporal_raw_parsers` / `session_time_zone` / `date_style`).
- `_copy.mjs` `normalizeForPg()` throws if it ever receives a JS `Date`
  (regression guard against silent re-corruption).
- New regression test: `npm run old-to-prod:test-temporal`
  (`scripts/old-to-prod/11_test_temporal_roundtrip.mjs`, TEMP table +
  ROLLBACK, zero persisted change).

Re-insert of the canonical raw text round-trips byte-identically and the
server-side `md5(string_agg(t::text))` is now UTC/ISO-deterministic on both
sides → checksums match. **Re-run export → prepare → import → verify until
`VERIFY_OK`** (operator must authorize the destructive import explicitly).

## Gate

- Go BFF verification: **BLOCKED** (per operator instruction: VERIFY not OK).
- Yandex migration: **BLOCKED** (`READY_FOR_YANDEX_MIGRATION` requires
  strict `VERIFY_OK`).
- Destructive env flags: ephemeral session-only, none persisted to disk;
  `.env.old-to-prod` all `=false`.
