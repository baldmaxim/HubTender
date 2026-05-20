# 07. SCHEMA BUILD REPORT

> Stage 1 (Build clean Yandex PostgreSQL schema) of
> [02_PROD_TO_YANDEX_PLAN.md](./02_PROD_TO_YANDEX_PLAN.md). **No data migrated.
> No runtime changed. No real schema applied in this build.**
>
> Generated alongside `db/yandex/`. Apply / verify results live in their own
> docs: [08_SCHEMA_APPLY_RESULT.md](./08_SCHEMA_APPLY_RESULT.md) (written by
> `01_apply_schema.mjs`) and
> [09_SCHEMA_VERIFY_RESULT.md](./09_SCHEMA_VERIFY_RESULT.md) (written by
> `02_verify_schema.mjs`).

- Build date (repo time): 2026-05-17
- Source of truth: **`supabase/migrations/`** (1–14). `supabase/schemas/prod.sql`
  used only as a cross-check reference, never as a deploy script.
- Forbidden source: `OLD_SUPABASE_DB_URL` (project `wkywhjljrhewfpedbjzx`) — not
  referenced anywhere in `db/yandex/` or as a source in
  `scripts/prod-to-yandex/`.

## 1. Output inventory

```
db/yandex/
  README.md
  sql/
    00_schemas.sql                 schemas: public (ensure) + auth (bridge)
    01_auth_compat_or_app_auth.sql auth.uid() shim + thin auth.users/auth.identities
    02_enums.sql                   11 application enums (Cyrillic preserved)
    03_tables.sql                  40 public tables — columns + defaults only
    04_functions.sql               30 functions (29 from migr.5 + save_redistribution_results)
    05_triggers.sql                business triggers (updated_at/audit/grand-total/registry)
    06_indexes_constraints.sql     PK → UNIQUE → CHECK → FK → indexes
    07_pgnotify.sql                notify_row_change() + rowchange triggers (6 tables)
    08_permissions.sql             no-op (deferred runtime-role grant template)
    90_rls_note.sql                documentation only (no policies)
scripts/prod-to-yandex/
  README.md
  .env.prod-to-yandex.example      (OLD_SUPABASE_DB_URL deliberately absent)
  00_check_connections.mjs         read-only PROD+Yandex check
  01_apply_schema.mjs              ordered apply, --dry-run, --from/--to, two-key guard
docs/yandex-migration/
  07_SCHEMA_BUILD_REPORT.md        (this file)
```

## 2. Schema strategy summary

- **Source = ordered migrations**, not `prod.sql` (which is public-only, has
  broken cross-schema FKs `REFERENCES None.None`, and no auth/RLS/triggers).
- **Excluded Supabase-internal schemas/objects:** `realtime`, `storage`,
  `vault`, `graphql`, `supabase_migrations`, `pgsodium`, `pg_net`,
  `extensions`, PostgREST artefacts, the `pgrst` reload channel.
- **No `CREATE EXTENSION`** — `pgcrypto` / `uuid-ossp` are enabled at the
  cluster level (green [06_YANDEX_PREFLIGHT](./06_YANDEX_PREFLIGHT.md):
  `pgcrypto, plpgsql, uuid-ossp`).
- **No `CREATE ROLE` / `ALTER ROLE` / `ALTER SYSTEM` /
  `session_replication_role`.** No Supabase DB roles
  (`anon`/`authenticated`/`service_role`/`authenticator`).
- **UUID defaults unified:** every `DEFAULT extensions.uuid_generate_v4()`
  (~all 36 id columns in migration 2) → `DEFAULT gen_random_uuid()`. Decision:
  `gen_random_uuid()` (from `pgcrypto`) is unqualified, modern, and already
  available; no schema-qualified extension calls remain. (`uuid-ossp` stays
  enabled on the cluster but is no longer required by the cleaned defaults.)
- **Import-friendly split:** `03_tables.sql` = columns + defaults only;
  PK/UNIQUE/CHECK/FK + indexes deferred to `06_indexes_constraints.sql` so a
  future bulk PROD→Yandex load runs before constraint validation.
- **Idempotency:** enums (DO-guard), tables (`IF NOT EXISTS`), functions
  (`OR REPLACE`), triggers (`DROP IF EXISTS` + `CREATE`), indexes
  (`IF NOT EXISTS`) are re-runnable. `06` PK/UNIQUE/CHECK/FK uses plain
  `ALTER … ADD CONSTRAINT` (verbatim from source) targeting an **empty** DB —
  guaranteed by the preflight gate (`public BASE TABLE count = 0`).

## 3. Auth compatibility strategy

**Chosen: Option A — minimal `auth.users` compatibility bridge**
([03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) §4–5,
[04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md)).

- `auth` schema + thin `auth.users` parent table. Column set is a superset of
  what the PROD exporter projects (`scripts/old-to-prod/_auth.mjs`: id, email,
  encrypted_password, email_confirmed_at, raw_user_meta_data,
  raw_app_meta_data, role, phone, phone_confirmed_at, created_at, updated_at,
  last_sign_in_at, banned_until, deleted_at, is_sso_user, is_anonymous) **plus**
  the GoTrue NOT-NULL token columns (`confirmation_token`, `recovery_token`,
  `email_change_token_new`, `email_change_token_current`, `email_change`,
  `reauthentication_token`, `phone_change`, `phone_change_token`) defaulting to
  `''` to mirror PROD's repaired state
  (`scripts/old-to-prod/_mapping.mjs` `AUTH_USERS_NOT_NULL_TOKENS`).
- `encrypted_password` (bcrypt) preserved **as-is** for a later Go app-auth
  migration. Never logged, never rehashed.
- `auth.identities` kept as an optional compat table for import/verify parity
  (generated `email` mirrors Supabase Auth ≥2023.5
  `GENERATED ALWAYS AS lower(identity_data->>'email') STORED`). Not a runtime
  dependency. GoTrue sessions/refresh tokens are **not** modelled — users log
  in again after the auth cutover.
- `app_auth.password_credentials` (Option B) and FK rewrite are **out of
  scope** for this stage (separate follow-up).
- **FK strategy:** all public FKs historically pointing at `auth.users(id)` are
  preserved against the bridge table (`users.id`, `tenders.created_by`,
  `tender_registry.created_by`, `markup_tactics.user_id`,
  `import_sessions.user_id`/`cancelled_by`, `tender_notes.user_id`,
  `comparison_notes.created_by`, `cost_redistribution_results.created_by`).

### `auth.uid()` handling (per [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) §7 / task §12)

Decision: a single **`auth.uid()` compatibility function** (in
`01_auth_compat_or_app_auth.sql`) resolving from
`current_setting('app.user_id', true)` → fallback
`current_setting('app.current_user_id', true)` → `NULL`. The Go BFF sets that
GUC per request; `set_audit_user()` / `clear_audit_user()` already drive
`app.current_user_id`. Functions therefore keep calling `auth.uid()` unchanged —
no Supabase dependency remains.

| Function | Uses `auth.uid()` | Decision |
|---|---|---|
| `current_user_role()` | yes (`WHERE id = auth.uid()`) | Resolved via shim. Future: may take `p_user_id` when Go calls it directly. |
| `current_user_status()` | yes | Resolved via shim. |
| `is_tender_timeline_privileged()` | yes | Resolved via shim. |
| `log_boq_items_changes()` (trigger) | yes (in BEGIN/EXCEPTION) | Resolved via shim; degrades to NULL `changed_by` when GUC unset (same as PROD when no JWT). |
| `respond_tender_iteration()` | yes (`manager_id = auth.uid()`, privilege check) | Resolved via shim. Future: parameterize `p_user_id` when invoked by Go. |
| `set_tender_group_quality()` | yes (`quality_updated_by = auth.uid()`, existence check) | Resolved via shim. Future: parameterize `p_user_id`. |
| 7 functions patched by PROD migration 10 (`handle_updated_at`, `auto_archive_tender_registry`, `auto_create_tender_registry`, `get_positions_with_costs`, `trg_boq_items_update_grand_total`, `trg_markup_pct_update_grand_total`, `trg_subcontract_excl_update_grand_total`) | no | `SET search_path` baked inline instead of the dynamic `ALTER FUNCTION` loop. |

## 4. pg_notify preserved (exactly)

`public.notify_row_change()` + channel **`rowchange`** + AFTER
INSERT/UPDATE/DELETE triggers on `tenders`, `notifications`, `boq_items`,
`client_positions`, `cost_redistribution_results`,
`construction_cost_volumes` are ported verbatim in `07_pgnotify.sql`. Runtime
note: the Go realtime listener needs a direct/session-safe DSN
(`YANDEX_DIRECT_DATABASE_URL`) — still an open warning for the **final runtime
cutover** ([06_YANDEX_PREFLIGHT](./06_YANDEX_PREFLIGHT.md),
[05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md) §9), **not** a blocker for the
schema build.

## 5. RLS exclusion

Supabase RLS (≈16 tables, 35+ policies from migration 8 + 13) is **not
ported**. `90_rls_note.sql` documents the excluded policies and rationale: the
policies depend on `(SELECT auth.uid())` and Supabase roles that don't exist on
Yandex. Access control is enforced by the **Go BFF** (single runtime DB
client). Future defence-in-depth, if added, must use
`current_setting('app.user_id', true)` and is a separate design.

## 6. Verification results

### Forbidden-statement scan
`rg "CREATE EXTENSION|CREATE ROLE|ALTER ROLE|ALTER SYSTEM|session_replication_role|TO authenticated|TO anon|service_role|authenticator" db/yandex`

- **No executable forbidden statements.** Every match is inside a `--` SQL
  comment (00, 01, 02, 03, 04, 06, 08, 90) or `db/yandex/README.md` prose,
  describing what was *excluded*. No `CREATE EXTENSION` / `CREATE ROLE` /
  `ALTER ROLE` / `ALTER SYSTEM` / `session_replication_role` / `TO
  authenticated|anon` / `service_role` / `authenticator` is executed.

### Source-of-truth (OLD) scan
`rg "OLD_SUPABASE_DB_URL" scripts/prod-to-yandex db/yandex docs/yandex-migration`

- `db/yandex/` — **no matches**.
- `scripts/prod-to-yandex/` — referenced **only** as a hard guard:
  `00_check_connections.mjs` aborts if `OLD_SUPABASE_DB_URL` is set; the
  `.env` example states it must stay absent. Never used as a source.
- `docs/yandex-migration/` — OLD mentioned only as the forbidden historical
  source.

### Script syntax / dry-run
- `node --check scripts/prod-to-yandex/*.mjs` → OK
- `npm run prod-to-yandex:schema -- --dry-run` → `SCHEMA_DRY_RUN_OK`; lists the
  10 files in lexical order, runs the comment-aware forbidden scan (clean), no
  DB connection. Full result: [08_SCHEMA_APPLY_RESULT.md](./08_SCHEMA_APPLY_RESULT.md).
- `npm run prod-to-yandex:verify-schema` (before apply / no env) →
  `SCHEMA_VERIFY_FAILED` with clear per-check detail (no stack trace). Full
  result: [09_SCHEMA_VERIFY_RESULT.md](./09_SCHEMA_VERIFY_RESULT.md).
- `npm run prod-to-yandex:check` → requires real `PROD_SUPABASE_DB_URL` /
  `YANDEX_DATABASE_URL` (not set in this build) — not run here.

## 7. Is real Yandex schema apply ready?

**The schema is build-ready, but a real apply is intentionally NOT performed
and NOT authorised in this stage.** Real apply requires all of:

1. `scripts/prod-to-yandex/.env.prod-to-yandex` filled from Lockbox
   (`YANDEX_DATABASE_URL`, `YANDEX_SSL_ROOT_CERT` / DSN `sslrootcert`).
2. `ALLOW_APPLY_SCHEMA=true` **and** an explicit, operator-authorised
   non-`--dry-run` invocation.
3. Green preflight gate (already
   `YANDEX_PREFLIGHT_OK_WITH_WARNINGS`: connection/SSL/PG17/extensions/empty all
   OK).

### Blockers / warnings

- **No blockers** for the schema build.
- **Warning (carried over):** `YANDEX_DIRECT_DATABASE_URL` not set — affects
  only the **final runtime cutover** (LISTEN/NOTIFY on a session-safe DSN), not
  schema/data preparation.
- `06_indexes_constraints.sql` is not idempotent on its own (plain
  `ADD CONSTRAINT`) — apply to the empty target guaranteed by the preflight
  gate **and** the apply-time empty-target precheck in `01_apply_schema.mjs`.

---

> Apply / verify outcomes are tracked in
> [08_SCHEMA_APPLY_RESULT.md](./08_SCHEMA_APPLY_RESULT.md) and
> [09_SCHEMA_VERIFY_RESULT.md](./09_SCHEMA_VERIFY_RESULT.md), not appended here.

## Post-apply correction — audit FK (2026-05-17)

The first real PROD→Yandex data import failed on `public.boq_items_audit`:
the cleaned schema carried an **enforced** FK
`boq_items_audit_boq_item_id_fkey (boq_item_id → boq_items ON DELETE CASCADE)`
inherited from baseline migration `00000000000003`, but **live PROD Supabase
has no such FK** (only `changed_by → users`). `boq_items_audit` is
historical/audit storage — DELETE-history rows legitimately reference removed
`boq_items` (PROD export: 388 598 rows, 157 730 orphan, 66 639 distinct orphan
parents). An enforced FK is incompatible with delete-audit semantics.

Correction applied to the foundation:
- `db/yandex/sql/06_indexes_constraints.sql` no longer creates that FK; it
  keeps a non-FK lookup index `idx_boq_items_audit_boq_item_id` + a rationale
  comment. PK and all other FKs are unchanged.
- Integrity is now verified by an **audit-history baseline check**
  (`05_verify_yandex`), not FK enforcement; `02_verify_schema` fails if the
  enforced FK is still present.
- The already-applied Yandex schema is corrected by the gated repair script
  `scripts/prod-to-yandex/10_repair_yandex_schema_audit_fk.mjs`.

Full diagnostic + decision: [15_AUDIT_FK_SCHEMA_DECISION.md](./15_AUDIT_FK_SCHEMA_DECISION.md).
A secondary, out-of-scope discrepancy was noted: `boq_items_audit_changed_by_fkey`
ON DELETE rule is `SET NULL` on PROD vs `NO ACTION` in the cleaned schema
(recorded, not changed).
