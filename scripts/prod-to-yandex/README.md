# scripts/prod-to-yandex

Future PROD Supabase → Yandex Managed PostgreSQL pipeline. **This stage builds
and applies the cleaned schema only — no data is migrated here.**

| Script | npm | What it does |
|---|---|---|
| `00_check_connections.mjs` | `npm run prod-to-yandex:check` | Read-only: PROD source + Yandex target reachable, PG majors match, Yandex `pgcrypto`/`uuid-ossp` enabled, target empty/ready. Writes nothing. |
| `01_apply_schema.mjs` | `npm run prod-to-yandex:schema` | Applies `db/yandex/sql/*.sql` in lexical order. `--dry-run` (no connect), `--from`/`--to` range, real apply gated by `ALLOW_APPLY_SCHEMA=true`. Appends results to `docs/yandex-migration/07_SCHEMA_BUILD_REPORT.md`. |

## Rules

- **Source = PROD Supabase only.** `OLD_SUPABASE_DB_URL` is never read; if set in
  the env, `00_check` aborts (see
  [00_SOURCE_OF_TRUTH.md](../../docs/yandex-migration/00_SOURCE_OF_TRUTH.md)).
- Secrets/DSN/certs are never printed and never committed. Copy
  `.env.prod-to-yandex.example` → `.env.prod-to-yandex` (git-ignored) and fill
  from Lockbox/Vault.
- Yandex connections use strict TLS `verify-full` (CA from
  `YANDEX_SSL_ROOT_CERT` or DSN `sslrootcert=`); no insecure downgrade.
- Real schema apply needs **both** `ALLOW_APPLY_SCHEMA=true` **and** a
  non-`--dry-run` run explicitly authorised by the operator
  ([05_CUTOVER_RULES.md](../../docs/yandex-migration/05_CUTOVER_RULES.md)).

## Typical flow

```bash
cp scripts/prod-to-yandex/.env.prod-to-yandex.example \
   scripts/prod-to-yandex/.env.prod-to-yandex      # fill from Lockbox
npm run prod-to-yandex:check
npm run prod-to-yandex:schema -- --dry-run
# only when authorised:
ALLOW_APPLY_SCHEMA=true npm run prod-to-yandex:schema
```
