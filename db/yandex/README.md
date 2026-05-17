# db/yandex — Cleaned PostgreSQL schema foundation for Yandex Managed PostgreSQL

> **Status:** schema foundation only. **No data is migrated by anything in this
> folder.** Source of truth = `supabase/migrations/` (NOT
> `supabase/schemas/prod.sql`).

This directory holds the deploy-ready, Supabase-free SQL schema for the target
**Yandex Managed Service for PostgreSQL** cluster. It is the Stage 1 output of
[docs/yandex-migration/02_PROD_TO_YANDEX_PLAN.md](../../docs/yandex-migration/02_PROD_TO_YANDEX_PLAN.md).

## Source of truth

| Allowed | Forbidden |
|---|---|
| `supabase/migrations/` (ordered application DDL — the canonical source) | `supabase/schemas/prod.sql` as a deploy script (public-only dump, broken cross-schema FKs `REFERENCES None.None`, no auth/RLS/triggers) |
| PROD Supabase (`ocauafggjrqvopxjihas`) as the future data source | OLD Supabase (`wkywhjljrhewfpedbjzx`) — never a source for the Yandex stage |

`prod.sql` may be consulted **only** as a cross-check reference for a single
object, never run.

## What was deliberately excluded

* **Supabase-internal schemas/objects:** `realtime`, `storage`, `vault`,
  `graphql`, `supabase_migrations`, `pgsodium`, `pg_net`, `extensions`,
  PostgREST artefacts.
* **Supabase DB roles:** `anon`, `authenticated`, `service_role`,
  `authenticator` — not created, not granted to.
* **Supabase RLS policies:** ~16 tables / 35+ policies. Not ported (see
  `sql/90_rls_note.sql`). Access control is enforced by the Go BFF.
* **`CREATE EXTENSION`:** `pgcrypto` / `uuid-ossp` are enabled at the **cluster
  level** (green Yandex preflight). SQL never issues `CREATE EXTENSION`.
* **`CREATE ROLE` / `ALTER ROLE` / `ALTER SYSTEM` / `session_replication_role`.**
* **Schema-qualified extension calls:** `extensions.uuid_generate_v4()` →
  `gen_random_uuid()`.
* **Supabase/PostgREST `pgrst` reload channel** (Go BFF does not use it).
* The `GRANT EXECUTE ... TO authenticated` on `save_redistribution_results`.

## File order (lexical = apply order)

| File | Contents |
|---|---|
| `sql/00_schemas.sql` | `public` (ensure) + `auth` (bridge) schemas |
| `sql/01_auth_compat_or_app_auth.sql` | `auth.uid()` shim + thin `auth.users` / `auth.identities` bridge tables (Option A) |
| `sql/02_enums.sql` | 11 application enums (Cyrillic labels preserved) |
| `sql/03_tables.sql` | 40 public tables — columns + defaults only (no PK/UNIQUE/CHECK/FK) |
| `sql/04_functions.sql` | application functions (auth.uid() handled via the shim) |
| `sql/05_triggers.sql` | updated_at / audit / grand-total / registry triggers |
| `sql/06_indexes_constraints.sql` | PK → UNIQUE → CHECK → FK → indexes (import-friendly order) |
| `sql/07_pgnotify.sql` | `notify_row_change()` + `rowchange` triggers (6 tables) |
| `sql/08_permissions.sql` | no-op; deferred runtime-role grant template |
| `sql/90_rls_note.sql` | documentation only; no policies created |

Idempotency: `02` (enum DO-guards), `03` (`CREATE TABLE IF NOT EXISTS`), `04`
(`CREATE OR REPLACE`), `05`/`07` (`DROP TRIGGER IF EXISTS` + `CREATE`), indexes
(`IF NOT EXISTS`) are re-runnable. **`06` PK/UNIQUE/CHECK/FK uses plain
`ALTER ... ADD CONSTRAINT`** (verbatim from the source migrations) and targets an
**empty** database — guaranteed by the green
[06_YANDEX_PREFLIGHT](../../docs/yandex-migration/06_YANDEX_PREFLIGHT.md) gate.

## Auth bridge (Option A)

`auth.users` is a **thin compatibility parent** keeping `encrypted_password`
(bcrypt, as-is, never logged/rehashed) so a later stage can move it into
`app_auth.password_credentials` (Option B) and rewrite the FKs. `auth.uid()`
resolves the acting user from the `app.user_id` / `app.current_user_id` session
GUC set by the Go BFF — **not** Supabase GoTrue. GoTrue
sessions/refresh-tokens are not modelled (users log in again after the auth
cutover). See
[04_AUTH_STRATEGY.md](../../docs/yandex-migration/04_AUTH_STRATEGY.md).

## How to apply (NOT in this prompt)

Applying is a future, explicitly-authorised step. The mechanics:

```bash
cp scripts/prod-to-yandex/.env.prod-to-yandex.example \
   scripts/prod-to-yandex/.env.prod-to-yandex   # fill from Lockbox; git-ignored

npm run prod-to-yandex:check                     # read-only connectivity/version/ext/empty
npm run prod-to-yandex:schema -- --dry-run       # list files + ranges, no DB connection

# Real apply requires BOTH: env ALLOW_APPLY_SCHEMA=true AND operator intent.
ALLOW_APPLY_SCHEMA=true npm run prod-to-yandex:schema
# Range subset:
npm run prod-to-yandex:schema -- --from 03_tables.sql --to 06_indexes_constraints.sql --dry-run
```

Secrets/DSN are never printed or committed. Data import (PROD → Yandex) is a
separate later stage and is **not** performed by `01_apply_schema.mjs`.

## Related docs

* [00_SOURCE_OF_TRUTH.md](../../docs/yandex-migration/00_SOURCE_OF_TRUTH.md)
* [03_SCHEMA_STRATEGY.md](../../docs/yandex-migration/03_SCHEMA_STRATEGY.md)
* [05_CUTOVER_RULES.md](../../docs/yandex-migration/05_CUTOVER_RULES.md)
* [07_SCHEMA_BUILD_REPORT.md](../../docs/yandex-migration/07_SCHEMA_BUILD_REPORT.md)
