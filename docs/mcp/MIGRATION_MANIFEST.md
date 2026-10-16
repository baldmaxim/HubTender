# Migration manifest

Apply after the existing Yandex baseline/incrementals and before enabling MCP:

```text
db/yandex/incremental/2026_09_tenderhub_mcp_v1.sql
db/yandex/incremental/2026_10_tenderhub_direct_pricing.sql
db/yandex/incremental/2026_10_tenderhub_mcp_catalog_creation.sql
db/yandex/incremental/2026_10_mcp_row_authorship.sql
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
- nullable legacy `draft_operation_id` plus a direct request key, source
  library ID, match level, confidence, and warnings
- `public.mcp_direct_pricing_requests`: immutable committed-command receipt
  keyed by actor and request key for retry safety
- `public.mcp_catalog_creation_requests`: confirmed catalog inputs, actor/client,
  creation/reuse result and retry receipt; normalized-name non-unique indexes
- `pg_trgm` indexes on work/material/position names
- `public.client_position_gp_audit` + trigger `trg_client_positions_gp_audit`:
  old/new Количество ГП and note, author, MCP request key, `version_copy` origin
- `public.boq_audit_counts_as_authorship`, `public.boq_item_last_authorship`,
  `public.client_position_gp_last_authorship`: last author for MCP rules
- `public.copy_boq_item_authorship`, `public.copy_position_gp_authorship` and a
  new `public.clone_tender_as_new_version`: a version copy keeps the authors

The migrations are additive and idempotent. Apply the direct-pricing migration
before deploying the new BFF. `CREATE EXTENSION pg_trgm` is a hard gate for
the first migration. Production rollback disables write access but retains
audit/provenance rows and historical drafts.

The authorship migration needs no portal downtime; order: migration → backend →
frontend. Verify with `scripts/mcp/verify_row_authorship.sql`; see `AUTHORSHIP.md`.
