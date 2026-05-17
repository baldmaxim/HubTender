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

## Final status

```
RUNBOOK
```
