# 10. DATA MIGRATION RUNBOOK — PROD Supabase → Yandex

> Operator runbook for the data stage. The Yandex schema is already applied &
> verified (`08_SCHEMA_APPLY_RESULT.md` = SCHEMA_APPLY_OK,
> `09_SCHEMA_VERIFY_RESULT.md` = SCHEMA_VERIFY_OK). This stage migrates DATA
> only. Read `05_CUTOVER_RULES.md` and `04_AUTH_STRATEGY.md` first.

## 0. Hard rules

- **Source = PROD Supabase ONLY.** `PROD_SUPABASE_DB_URL` (or, preferred when
  set, `PROD_SUPABASE_EXPORT_DB_URL`). `OLD_SUPABASE_DB_URL` is FORBIDDEN —
  every script fails fast (exit 7) if it is present in the environment.
- Secrets / DSNs / certificates / bcrypt hashes / tokens are NEVER printed and
  NEVER committed.
- No `--allow-overwrite`. No `ALLOW_PROD_OVERWRITE`. No
  `session_replication_role`. No `CREATE EXTENSION` / `CREATE ROLE`.
- The Yandex target must be ROW-EMPTY before a real import. **After schema
  apply the target is EXPECTED to contain the schema tables (≈42: 40 public +
  `auth.users` + `auth.identities`) — that is the correct ready state, NOT a
  failure.** Readiness = schema verified OK + only `public`/`auth` non-system
  schemas + every app/auth table at 0 rows. Populated (>0 rows) tables block
  the first import unless `--clean-yandex --confirm` + `ALLOW_CLEAN_YANDEX=true`.

## 1. Prerequisites

1. `cp scripts/prod-to-yandex/.env.prod-to-yandex.example
   scripts/prod-to-yandex/.env.prod-to-yandex` and fill from Lockbox/Vault.
2. Yandex schema applied + verified: `09_SCHEMA_VERIFY_RESULT.md` must end with
   `SCHEMA_VERIFY_OK`. If not: `npm run prod-to-yandex:verify-schema` (and fix
   blockers / re-apply via `npm run prod-to-yandex:schema`).
3. `npm run prod-to-yandex:check` — confirms PROD reachable, Yandex reachable,
   PG majors match, `pgcrypto`/`uuid-ossp` enabled, schema verified, and
   **data-phase target readiness**. Post-schema-apply this reports
   `Yandex target readiness — schema-applied empty target: OK — N tables,
   0 rows (ready for first import)`; it does NOT fail merely because the
   schema tables exist. (If PROD is still unreachable, that PROD check is the
   only expected blocker; Yandex readiness is independent and stays OK.)
4. `bcryptjs` is a committed dependency, so `npm install` enables the optional
   local bcrypt smoke in `06_verify_passwords` (see §4).

## 2. Resolving a PROD Supabase timeout

The Supabase free-tier direct host `db.<ref>.supabase.co` is **IPv6-only** and
usually unreachable from CI / most networks → connect/query `ETIMEDOUT`.

- Set `PROD_SUPABASE_EXPORT_DB_URL` to the **Session Pooler** endpoint
  `postgresql://...@aws-0-<region>.pooler.supabase.com:5432/postgres`
  (session mode, port 5432 — NOT the 6543 transaction pooler).
- Export & verify automatically prefer `PROD_SUPABASE_EXPORT_DB_URL` over
  `PROD_SUPABASE_DB_URL`. `00_check` probes the same resolved URL and prints a
  clear IPv6 / host-type / timeout diagnostic (never the DSN).
- When the only available path is the shared Session Pooler, run the export
  with `--pool-safe-export` AND an operator-confirmed no-writes window on PROD
  (cross-table consistency then relies on the freeze, recorded in the manifest).

## 3. Running the migration

```bash
# 0) connectivity / readiness
npm run prod-to-yandex:check

# 1) dry-run export (probe + counts; writes nothing)
npm run prod-to-yandex:export -- --dry-run

# 2) real export (read-only on PROD; REPEATABLE READ snapshot by default)
npm run prod-to-yandex:export
#   or, shared-pooler path with a confirmed freeze:
npm run prod-to-yandex:export -- --pool-safe-export

# 3) dry-run import (NO Yandex writes; plans only)
npm run prod-to-yandex:import -- --dry-run

# 4) real import (two-key gated)
ALLOW_DATA_IMPORT=true ALLOW_AUTH_IMPORT=true \
ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run prod-to-yandex:import
#   first run onto an empty target. If the target already has rows from a
#   previous attempt, either resume or clean:
#   --resume                          (ON CONFLICT DO NOTHING for completed)
#   --clean-yandex --confirm  (+ ALLOW_CLEAN_YANDEX=true; explicit-list DELETE)

# 5) verify data + passwords
npm run prod-to-yandex:verify
npm run prod-to-yandex:verify-passwords

# Or the whole pipeline:
npm run prod-to-yandex:migrate -- --dry-run        # safe, no writes
ALLOW_DATA_IMPORT=true ALLOW_AUTH_IMPORT=true ALLOW_DISABLE_IMPORT_TRIGGERS=true \
  npm run prod-to-yandex:migrate
```

Result docs (overwritten each run):
`11_DATA_EXPORT_REPORT.md`, `12_DATA_IMPORT_REPORT.md`,
`13_YANDEX_VERIFY_RESULT.md`, `14_YANDEX_AUTH_VERIFY_RESULT.md`.

## 4. Password preservation

`auth.users.encrypted_password` (bcrypt) is migrated **byte-for-byte**: it is
never rehashed, never logged, and only ever sha256-fingerprinted for
comparison. `06_verify_passwords` compares PROD-export vs Yandex by sha256 and
(optionally) does a LOCAL bcrypt smoke if `MIGRATION_SMOKE_EMAIL` /
`MIGRATION_SMOKE_PASSWORD` are set — it fetches the hash from Yandex and
bcrypt-compares locally; it NEVER calls a Supabase Auth endpoint (Yandex has no
GoTrue). The bcrypt smoke is **enabled by the bundled `bcryptjs` dependency**
(installed via `npm install`), so it is no longer skipped for a missing module.
Behaviour when `MIGRATION_SMOKE_EMAIL` / `MIGRATION_SMOKE_PASSWORD` are set:
`bcrypt.compare(password, yandex_encrypted_password)` — password and hash are
never printed. Match → `smoke_password_check` OK. **Mismatch →
`YANDEX_AUTH_VERIFY_FAILED`** (exit 1). If the smoke creds are not set the
smoke is simply not run (a warning is acceptable; status may be
`OK_WITH_WARNINGS`).

## 5. Why Supabase sessions don't migrate

`auth.sessions` / `auth.refresh_tokens` are tied to the PROD Supabase project's
`instance_id` and JWT secret. Yandex has no GoTrue. They are intentionally NOT
exported or imported. After the runtime auth cutover, the Go BFF issues its own
sessions; every user must **log in again** (their bcrypt password is
preserved, so the same credentials work). See `04_AUTH_STRATEGY.md` §5–6.

## 6. Why users re-login after the app-auth switch

The Yandex `auth.users` bridge (Option A) preserves identity + password but is
NOT GoTrue. When the Go BFF app-auth path goes live it does not honour old
Supabase JWTs/sessions, so all users re-authenticate once. No password reset is
required.

## 7. Rollback (before runtime cutover)

Data import is fully reversible while the app still points at PROD Supabase:

- The Yandex target is a separate cluster; PROD Supabase is untouched
  (export is strictly read-only).
- To redo: `--clean-yandex --confirm` (+ `ALLOW_CLEAN_YANDEX=true`) performs an
  explicit-list `DELETE` in reverse FK order (no CASCADE), then re-import.
- Do NOT switch `DATABASE_URL` / the app to Yandex until
  `13_YANDEX_VERIFY_RESULT.md` = `YANDEX_VERIFY_OK` and
  `14_YANDEX_AUTH_VERIFY_RESULT.md` = `YANDEX_AUTH_VERIFY_OK`.

## 8. Direct / session-safe DSN warning for the final realtime cutover

The Go BFF realtime hub uses Postgres `LISTEN/NOTIFY` on channel `rowchange`.
A **transaction-pooler** endpoint breaks LISTEN/NOTIFY. For the final runtime
cutover the Go BFF must hold a **direct / session-safe** Yandex connection
(`YANDEX_DIRECT_DATABASE_URL`). This is a runtime concern, NOT a data-migration
concern — the data scripts here only read/write rows. See
`05_CUTOVER_RULES.md` §9 and `07_pgnotify.sql`.

## 9. Audit/history tables — no enforced FK (boq_items_audit)

Audit/history tables intentionally reference **deleted** parent rows:
`boq_items_audit` keeps INSERT/UPDATE/**DELETE** history, so
`boq_items_audit.boq_item_id` is a *historical* reference, not a live FK. An
enforced FK is incompatible with delete-audit semantics and **does not exist on
live PROD Supabase**. The cleaned Yandex schema therefore **omits** this FK
(keeps only the non-FK index `idx_boq_items_audit_boq_item_id`). Integrity is
verified by comparing the **audit baseline** (total / orphan / unique-orphan
counts; checksums) PROD-export ↔ Yandex — NOT by FK enforcement.

If a previously-applied Yandex schema still has the spurious FK, the data
import fails fast (`boq_items_audit_boq_item_id_fkey exists; run schema repair
before import`). Repair the applied schema with the gated script:

```bash
npm run prod-to-yandex:repair-audit-fk -- --dry-run        # plan only, no changes
# only when operator-authorised:
ALLOW_REPAIR_YANDEX_SCHEMA=true \
  npm run prod-to-yandex:repair-audit-fk -- --apply
npm run prod-to-yandex:verify-schema                       # must be SCHEMA_VERIFY_OK
```

Result doc: `16_SCHEMA_REPAIR_AUDIT_FK_RESULT.md`
(`SCHEMA_REPAIR_DRY_RUN_OK` / `SCHEMA_REPAIR_OK` / `SCHEMA_REPAIR_FAILED`).
Diagnostic + decision: `15_AUDIT_FK_SCHEMA_DECISION.md`. After a successful
repair, the data import / clean-yandex / verify cycle is resumed only under the
existing two-key gates and a separate operator confirmation.

## 10. Clean partial Yandex import state (clean-only / variant B)

**Why this exists.** A failed/partial import leaves rows in the target. The
normal import path requires `SCHEMA_VERIFY_OK`, but `02_verify_schema` reports
`SCHEMA_VERIFY_FAILED` whenever tables are non-empty — so a full
`SCHEMA_VERIFY_OK` is **unreachable while partial-import rows remain**. That is
a deadlock: clean-yandex is exactly what removes those rows, but it was gated
behind the very status it would restore.

**clean-only** breaks the deadlock without weakening the normal import:

- It validates the schema **structure** (schemas, auth bridge, 40 public
  tables, 11 enums, `notify_row_change`, the 6 pg_notify `rowchange` triggers,
  `pgcrypto`/`uuid-ossp`, absence of Supabase-internal schemas, audit-FK
  compatibility) and **ignores non-empty row counts**.
- It does **not** require `manifest` / `SCHEMA_VERIFY_OK` /
  `ALLOW_DATA_IMPORT` / `ALLOW_AUTH_IMPORT` / `ALLOW_DISABLE_IMPORT_TRIGGERS`.
- It **never imports**. It only `DELETE`s rows from the explicit known
  application/auth table list in reverse import order (auth after public),
  then post-asserts every table at 0 rows. No `DROP`, no
  `TRUNCATE … CASCADE`, no `session_replication_role`, no system-trigger
  disable. Schema/functions/triggers/extensions are untouched.
- After `DATA_CLEAN_OK`, run `verify-schema` — it should now read
  `SCHEMA_VERIFY_OK`. Only then is the normal (strict) import allowed.

```bash
# dry-run clean (no writes; shows tables, current row counts, reverse order):
npm run prod-to-yandex:import -- --dry-run --clean-yandex --clean-only --confirm

# real clean (data only — operator-authorised):
$env:ALLOW_CLEAN_YANDEX="true"            # PowerShell
npm run prod-to-yandex:import -- --clean-yandex --clean-only --confirm
Remove-Item Env:\ALLOW_CLEAN_YANDEX -ErrorAction SilentlyContinue

# then re-verify the schema (expected SCHEMA_VERIFY_OK):
npm run prod-to-yandex:verify-schema
```

Result doc: `12_DATA_IMPORT_REPORT.md` (statuses
`DATA_CLEAN_DRY_RUN_OK` / `DATA_CLEAN_OK` / `DATA_CLEAN_FAILED`, alongside the
`DATA_IMPORT_*` statuses for the import mode). The normal import remains strict:
it still requires `SCHEMA_VERIFY_OK` + manifest + `ALLOW_DATA_IMPORT` +
`ALLOW_AUTH_IMPORT` + `ALLOW_DISABLE_IMPORT_TRIGGERS`, and is run only under a
separate operator confirmation.

## 11. Clean-only trigger protection

`boq_items` carries the AFTER-DELETE business trigger `trg_boq_items_audit`
(`log_boq_items_changes`). A bulk `DELETE FROM public.boq_items` therefore
**re-inserts one DELETE-audit row per deleted row into `boq_items_audit`** —
synthetic rows that are NOT PROD data and defeat the clean (this caused the
first clean-only `DATA_CLEAN_FAILED`: `boq_items_audit still has 113134 rows`).
The 6 `trg_notify_row_change_*` triggers also fire on every deleted row → a
pg_notify storm during cleanup.

clean-only therefore temporarily disables **only specific named user
triggers** for the duration of the clean:

- `public.boq_items` → `trg_boq_items_audit`, `trg_notify_row_change_boq_items`
- `public.tenders` / `notifications` / `client_positions` /
  `cost_redistribution_results` / `construction_cost_volumes` →
  their `trg_notify_row_change_*`

Rules: exact `schema.table` + exact trigger name; `discoverTriggers` only
matches `pg_trigger.tgisinternal = false` (user triggers). **No
`DISABLE TRIGGER ALL`, no system triggers, no `session_replication_role`, no
`DROP TRIGGER`.** Triggers are re-enabled in a `finally` (even on error) and
stay in the final schema. `session_replication_role` is forbidden because it
bypasses ALL triggers/FKs session-wide (incl. system/RI), is too blunt, and
masks integrity problems — per-trigger `DISABLE` is precise and auditable.

Env required for a **real** clean that needs trigger disable:
`ALLOW_CLEAN_YANDEX=true` **and** `ALLOW_DISABLE_IMPORT_TRIGGERS=true` (plus
`--clean-yandex --clean-only --confirm`). Without
`ALLOW_DISABLE_IMPORT_TRIGGERS` the real clean refuses
(`DATA_CLEAN_FAILED`, nothing cleaned) and explains it would otherwise generate
synthetic audit rows. The dry-run does **not** require it — it only lists the
triggers that would be disabled.

```bash
# dry-run (no writes, no triggers touched; lists planned disables):
npm run prod-to-yandex:import -- --dry-run --clean-yandex --clean-only --confirm

# real clean (operator-authorised):
$env:ALLOW_CLEAN_YANDEX="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
npm run prod-to-yandex:import -- --clean-yandex --clean-only --confirm
Remove-Item Env:\ALLOW_CLEAN_YANDEX -ErrorAction SilentlyContinue
Remove-Item Env:\ALLOW_DISABLE_IMPORT_TRIGGERS -ErrorAction SilentlyContinue

# then re-verify (expected SCHEMA_VERIFY_OK):
npm run prod-to-yandex:verify-schema
```

`12_DATA_IMPORT_REPORT.md` records: triggers planned / actually disabled /
re-enabled, the reason, and final row counts after clean.

## 12. Repair tenders.updated_at after trigger side effect

**What happened.** `tenders` carries `update_tenders_updated_at` (BEFORE UPDATE
`handle_updated_at`). The grand-total triggers
(`trg_boq_items_grand_total`, `trg_markup_pct_grand_total`,
`trg_insurance_grand_total`, `trg_subcontract_excl_grand_total`) call
`recalculate_tender_grand_total()` which `UPDATE public.tenders`. During the
first import those grand-total triggers were NOT in the disable set, so
importing `boq_items` / `tender_markup_percentage` / `tender_insurance` /
`subcontract_growth_exclusions` recomputed `cached_grand_total` and, via the
BEFORE-UPDATE trigger, **re-stamped `tenders.updated_at = now()`** on all 48
rows. Read-only diff confirmed: row counts equal, ids equal,
`cached_grand_total` and every business column identical — **only
`updated_at`** differed. This is not data corruption, but strict checksum
verification (`YANDEX_VERIFY`) fails on `tenders`.

**Root cause is fixed for future imports.** `04_import_yandex.mjs` now
dynamically discovers (via `pg_trigger`/`pg_proc.prosrc`/`pg_get_triggerdef`,
`tgisinternal=false`) every user trigger that calls
`recalculate_tender_grand_total()` / UPDATEs `public.tenders`, plus the tenders
`handle_updated_at` trigger, and disables them per-table during the bulk import
(re-enabled in finally; kept in the final schema). `REQUIRES_TRIGGER_DISABLE`
also lists them statically. A future clean re-import keeps
`tenders.updated_at` byte-stable.

**Targeted repair (preferred over a full re-import).** Restoring 48
`updated_at` values from the export snapshot is far cheaper and lower-risk than
re-cleaning + re-importing ~610k rows, and touches nothing else.
`11_repair_yandex_tenders_updated_at.mjs`:

- reads ONLY the export `data/public.tenders.ndjson` (never PROD DB),
- refuses unless row counts + id sets match AND **only `updated_at`** differs
  (any business-column drift → `TENDERS_UPDATED_AT_REPAIR_FAILED`, no change),
- on `--apply` temporarily disables ONLY `public.tenders` `handle_updated_at`
  (re-enabled in finally), runs
  `UPDATE public.tenders SET updated_at = <exported> WHERE id = <id>` (no other
  column/table), then post-asserts `updated_at` mismatch = 0 and no drift.

```bash
# dry-run (no writes; shows 48 updated_at mismatches, updates only updated_at):
npm run prod-to-yandex:repair-tenders-updated-at -- --dry-run

# real repair (operator-authorised):
$env:ALLOW_REPAIR_YANDEX_DATA="true"
npm run prod-to-yandex:repair-tenders-updated-at -- --apply
Remove-Item Env:\ALLOW_REPAIR_YANDEX_DATA -ErrorAction SilentlyContinue

# re-verify (expected YANDEX_VERIFY_OK / YANDEX_AUTH_VERIFY_OK):
npm run prod-to-yandex:verify
npm run prod-to-yandex:verify-passwords
```

Result doc: `17_TENDERS_UPDATED_AT_REPAIR_RESULT.md`
(`TENDERS_UPDATED_AT_REPAIR_DRY_RUN_OK` / `_OK` / `_FAILED`).

## Final status

```
RUNBOOK
```
