# Installation

## Zero gate: rotate exposed secrets

The source archive used during analysis contained populated `.env` files.
Before enabling MCP, rotate at minimum:

- the Yandex PostgreSQL password from `DATABASE_URL`;
- `SENTRY_AUTH_TOKEN`;
- the RSA key behind `APP_JWT_PRIVATE_KEY_*` and its `kid`.

Do not copy any `.env` from that archive. Use the server's secret store and
`deploy/mcp.env.example` only as a list of variable names.

## 1. Apply code on the colleague's checkout

The handoff patch is based on:

```text
repository: https://github.com/baldmaxim/HubTender
base commit: 6cbfa9bcd6ca491f7daaa94347d88d2b7236f31f
```

From a clean checkout:

```bash
git status --short
git merge-base --is-ancestor 6cbfa9bcd6ca491f7daaa94347d88d2b7236f31f HEAD
git am --3way 0001-tenderhub-mcp-v1.patch
```

Stop on conflicts. Do not accept either side wholesale in `routes.go`,
`wire.go`, `config.go`, or `App.tsx`; those are integration points.

## 2. Build before touching a database

```bash
cd backend
go mod tidy
go vet ./...
go test -p 1 ./...
go build ./cmd/server
cd ..

npm ci
npm run lint
npm run typecheck
VITE_API_URL=https://staging.example npm run build
```

## 3. Apply the additive migration on staging

Take a snapshot/backup first. `pg_trgm` must be enabled by the Yandex cluster;
the migration intentionally fails if it cannot be enabled.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/yandex/incremental/2026_09_tenderhub_mcp_v1.sql
```

Run the read-only verification queries from `scripts/mcp/verify_migration.sql`.
Do not run the migration on production until all staging gates pass.

## 4. Configure staging

Copy variable names from `deploy/mcp.env.example` into the protected backend
env file. Start with:

```dotenv
MCP_ENABLED=true
MCP_WRITE_ENABLED=false
MCP_TEMPLATE_WRITE_ENABLED=false
MCP_DCR_ENABLED=true
```

`APP_BASE_URL` must be the public origin, without `/api`. The MCP access token
has audience `hubtender-mcp`; a normal portal JWT cannot call `/mcp`.

Install the nginx locations from `deploy/nginx-mcp.conf.example`, validate with
`nginx -t`, then reload nginx.

## 5. Read-only pilot

Connect the MCP client to:

```text
https://<host>/mcp
```

The client performs DCR/CIMD discovery and opens `/agent-connect` in a browser.
Sign in with the engineer's own TenderHUB account and approve scopes. Confirm:

- `tenderhub_whoami` returns the engineer and client-specific scopes;
- archive/library/template reads work;
- all draft/apply calls return `503 Pricing writes disabled`.

## 6. Draft and write gates

After read-only acceptance:

1. Set `MCP_WRITE_ENABLED=true`, restart BFF, keep template writes false.
2. Pilot with two engineers and non-production tenders.
3. Validate a draft, review it in `/pricing-drafts`, confirm via the agent, and
   verify BOQ totals/audit/provenance by rereading TenderHUB.
4. Enable `MCP_TEMPLATE_WRITE_ENABLED=true` only if leading-engineer template
   UAT passes. Ordinary engineers remain blocked server-side.

