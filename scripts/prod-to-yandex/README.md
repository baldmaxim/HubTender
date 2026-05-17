# scripts/prod-to-yandex

Future PROD Supabase → Yandex Managed PostgreSQL pipeline. **This stage builds,
applies and verifies the cleaned schema only — no data is migrated here.**

| Script | npm | What it does |
|---|---|---|
| `00_check_connections.mjs` | `npm run prod-to-yandex:check` | Read-only: PROD source + Yandex target reachable, PG majors match, Yandex `pgcrypto`/`uuid-ossp` enabled, target empty/ready. Writes nothing. |
| `01_apply_schema.mjs` | `npm run prod-to-yandex:schema` | Applies `db/yandex/sql/*.sql` in lexical order, each file in its own transaction. Comment-aware forbidden-statement scan **before** apply; empty-target precheck before **real** apply. `--dry-run` (no connect), `--from`/`--to` range, real apply gated by `ALLOW_APPLY_SCHEMA=true`. Writes `docs/yandex-migration/08_SCHEMA_APPLY_RESULT.md`. |
| `02_verify_schema.mjs` | `npm run prod-to-yandex:verify-schema` | Read-only post-apply verification (schemas, auth bridge, tables, enums, functions, triggers, extensions, absence of Supabase internals, row counts, RLS). Writes `docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md`. |
| `_lib.mjs` | — | Shared env/redaction/connect helpers + comment-aware SQL scanner. |

## Safety model

- **Source = PROD Supabase only.** `OLD_SUPABASE_DB_URL` is never read; if set in
  the env, `00_check` aborts (see
  [00_SOURCE_OF_TRUTH.md](../../docs/yandex-migration/00_SOURCE_OF_TRUTH.md)).
- Secrets/DSN/certs are never printed and never committed. Copy
  `.env.prod-to-yandex.example` → `.env.prod-to-yandex` (git-ignored) and fill
  from Lockbox/Vault.
- Yandex connections use strict TLS `verify-full` (CA from
  `YANDEX_SSL_ROOT_CERT` or DSN `sslrootcert=`); no insecure downgrade.
- **Forbidden-statement scan** (comment-aware: ignores `--`/`/* */`, inspects
  string/dollar-quoted bodies) runs before any apply and refuses on
  `CREATE EXTENSION` / `CREATE ROLE` / `ALTER ROLE` / `ALTER SYSTEM` /
  `session_replication_role` / `GRANT … TO authenticated|anon` / `service_role`
  / `authenticator`.
- **Real apply two-key guard:** no `--dry-run` **and** `ALLOW_APPLY_SCHEMA=true`.
- **Empty-target precheck (real apply):** 0 user tables and only `public`/`auth`
  non-system schemas, else **fail, do not continue**.
- Each SQL file applies in its own `BEGIN`/`COMMIT`; first error →
  `ROLLBACK` and stop (no later files).
- `02_verify_schema` is read-only and, before the schema is applied or without a
  reachable/configured target, emits a clear `SCHEMA_VERIFY_FAILED` (never a
  stack trace).

## Result docs

- `docs/yandex-migration/08_SCHEMA_APPLY_RESULT.md` — `SCHEMA_DRY_RUN_OK` /
  `SCHEMA_APPLY_OK` / `SCHEMA_APPLY_FAILED`.
- `docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md` — `SCHEMA_VERIFY_OK` /
  `SCHEMA_VERIFY_OK_WITH_WARNINGS` / `SCHEMA_VERIFY_FAILED`.

## Typical flow

```bash
cp scripts/prod-to-yandex/.env.prod-to-yandex.example \
   scripts/prod-to-yandex/.env.prod-to-yandex      # fill from Lockbox
npm run prod-to-yandex:check
npm run prod-to-yandex:schema -- --dry-run
# only when explicitly authorised:
ALLOW_APPLY_SCHEMA=true npm run prod-to-yandex:schema
npm run prod-to-yandex:verify-schema
```
