# Migration manifest

Apply after the existing Yandex baseline/incrementals and before enabling MCP:

```text
db/yandex/incremental/2026_09_tenderhub_mcp_v1.sql
```

Objects:

- `app_auth.oauth_clients`
- `app_auth.oauth_authorization_codes`
- `app_auth.oauth_refresh_tokens`
- `app_auth.oauth_grants`
- `public.pricing_drafts`
- `public.pricing_draft_operations`
- `public.pricing_draft_events`
- `public.boq_item_pricing_sources`
- `pg_trgm` indexes on work/material/position names

The migration is additive and idempotent. `CREATE EXTENSION pg_trgm` is a hard
gate. Production rollback disables features but retains audit/provenance tables.

