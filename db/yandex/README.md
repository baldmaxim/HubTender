# db/yandex — PostgreSQL schema of record (Yandex Managed PostgreSQL)

> **Status:** live. Cutover to Yandex Managed PostgreSQL completed 2026-05-18.
> This directory is the **canonical source of truth** for the runtime schema:
> `sql/` — полная сборка схемы, `incremental/` — датированные пост-cutover
> миграции. Легаси Supabase-материалы удалены из рабочего дерева (доступны в
> git-истории).

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
**empty** database — guaranteed by the green Yandex preflight gate.

## Auth bridge (Option A)

`auth.users` is a **thin compatibility parent** keeping `encrypted_password`
(bcrypt, as-is, never logged/rehashed) so a later stage can move it into
`app_auth.password_credentials` (Option B) and rewrite the FKs. `auth.uid()`
resolves the acting user from the `app.user_id` / `app.current_user_id` session
GUC set by the Go BFF — **not** Supabase GoTrue. GoTrue
sessions/refresh-tokens are not modelled (users log in again after the auth
cutover).

## How to apply

The full `sql/` build was applied during the 2026-05 cutover. New changes go
through `incremental/<YYYY_MM>_<name>.sql`: apply manually via `psql` to the
Yandex cluster, then sync the full-schema files in `sql/` to match.

Secrets/DSN are never printed or committed. Migration history and planning
docs were archived under `archive/migrations/2026-05-db-cutover/` and removed
from the working tree (available in git history).
