# 30 — app_auth schema apply result

Log of dry-runs and real applies for `db/yandex/incremental/2026_05_app_auth_runtime.sql`.

## 2026-05-21T20:21:25.153Z — dry-run

- Source: `db/yandex/incremental/2026_05_app_auth_runtime.sql`
- Forbidden-pattern scan: **OK** (0 hits)
- Summary: 1 CREATE SCHEMA, 3 CREATE TABLE, 7 CREATE INDEX, 9 COMMENT ON (5622 bytes)
- DB connection: skipped (dry-run).

## 2026-05-21T20:45:28.230Z — apply FAILED (connect)

- Target host: `aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
- Error: password authentication failed for user "postgres"

## 2026-05-21T20:50:58.875Z — apply OK

- Target host: `rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net:6432/HubTender`
- Started:  2026-05-21T20:50:58.875Z
- Finished: 2026-05-21T20:50:59.845Z
- Forbidden-pattern scan: **OK** (0 hits)
- Summary: 1 CREATE SCHEMA, 3 CREATE TABLE, 7 CREATE INDEX, 9 COMMENT ON (5622 bytes)
- Status: **COMMITTED**
- Next: run `npm run app-auth:check-schema` to verify.

Final status: APP_AUTH_SCHEMA_APPLY_OK
