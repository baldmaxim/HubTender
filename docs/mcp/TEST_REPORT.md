# Local verification report

Date: 2026-09-22 (Asia/Yekaterinburg)  
Authoritative base: `baldmaxim/HubTender@6cbfa9bcd6ca491f7daaa94347d88d2b7236f31f`

## Passed

- Clean-repository preflight: PASS.
- Go formatting, vet, focused unit tests, MCP 18-tool schema/annotation contract: PASS.
- Frontend ESLint (`--max-warnings 0`), TypeScript and production Vite/PWA build: PASS.
- Production dependency audit (`npm audit --omit=dev`): 0 vulnerabilities after the non-breaking lockfile update.
- PostgreSQL 17 disposable integration environment:
  - full Yandex baseline schema: PASS;
  - every existing incremental migration through 2026-09: PASS;
  - MCP migration: PASS;
  - MCP migration second/idempotent application: PASS;
  - migration verification: `MCP_MIGRATION_OK`, 3 search indexes;
  - evaluation fixture apply and cleanup: PASS.
- Pricing integration: PASS.
  - exact/analog archive matching and furniture rejection;
  - original currency + target FX;
  - missing FX validation blocker;
  - template expansion with restored work/material parent link;
  - current TenderHUB financial revision bump;
  - BOQ audit + append-only provenance;
  - serializable all-or-nothing rollback on stale second operation;
  - idempotent repeated apply.
- OAuth integration: PASS.
  - PKCE S256, single-use code, audience/client scopes;
  - rotating refresh token and family revocation on reuse;
  - immediate grant revocation.
- Real HTTP BFF E2E on a disposable database: PASS.
  - public metadata/JWKS;
  - unauthenticated MCP challenge;
  - DCR → authorize → portal consent → token;
  - MCP 2026 `server/discover` and 18 typed tools;
  - revoked access token rejected immediately.
- Security scan of new `mcpauth`, `mcpserver`, and `pricing` packages with gosec: 0 issues.
- SQL parser validation with PostgreSQL AST parser: all migration/fixture/verification files parse.
- Performance against 100,006 BOQ rows in local PostgreSQL 17:
  - archive search p95: 17.23 ms (target <= 2 s);
  - pricing state p95: 82.38 ms (target <= 3 s);
  - transactional draft apply: 27.36 ms (target <= 30 s).

## Known upstream/base findings

- `govulncheck` reports `GO-2026-6452` in pre-existing
  `github.com/xuri/excelize/v2@v2.11.0`; no fixed upstream version was available.
  The reachable workbook boundary now recovers the malformed shared-string
  panic and returns a typed invalid-workbook error, preventing process failure.
- Full `npm audit` still reports the pre-existing Vite development-server
  `esbuild` advisory. The available automatic fix is a breaking Vite 8 upgrade;
  production dependencies audit clean and no dev server is deployed.
- On this Windows host, `go test ./...` could not execute the automatically
  named `internal/apikey.test.exe` because endpoint protection denied that
  filename. The same package was compiled to a neutral filename and all its
  tests passed. The Linux/CI command remains `go test -p 1 ./...`.

## Not claimed locally

No connection was made to the colleague's real TenderHUB server or production
database. Nginx placement, real OAuth-client compatibility, production data
quality, backup/restore and load targets must be rerun on that server's staging
environment using `INSTALL.md` and `VERIFY.md`. Production remains blocked until
those external gates pass.
