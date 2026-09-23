# Security model

- MCP uses a dedicated JWT audience (`hubtender-mcp`); portal JWTs are rejected.
- OAuth Authorization Code requires PKCE S256, exact registered redirects,
  state round-trip, issuer echo, hashed single-use codes, rotating hashed
  refresh tokens, and reuse-family revocation.
- DCR accepts public clients only, validates HTTPS/loopback redirect URIs and is
  rate-limited. CIMD is HTTPS-only, host-allowlisted, IP-pinned, size-limited,
  redirect-free, and rejects private/link-local addresses.
- Every MCP request rechecks the active grant and current TenderHUB user status.
- Tool handlers also enforce OAuth scope, portal page access, and role.
- Shared library/template writes are server-gated to `veduschiy_inzhener`,
  `administrator`, and `developer`; UI visibility is not trusted.
- Pricing apply requires a current validation hash plus explicit MCP elicitation
  confirmation. It runs in one serializable transaction and uses the canonical
  Go calculation kernel.
- Logs contain user/client/tool/status/duration only, never bearer tokens,
  arguments, full payloads, quote documents, or secrets.
- The handoff ZIP must not contain `.env`, credentials, database exports,
  customer BOQ data, OAuth tokens, or private keys.

