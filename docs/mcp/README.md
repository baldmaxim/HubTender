# TenderHUB MCP v1

Remote MCP for archive-grounded direct tender pricing. It is embedded in the
existing Go BFF and exposes `POST /mcp` over stateless Streamable HTTP.

## Supported workflow

1. Read already-created/imported tenders and direct-price completeness.
2. Search archived BOQ items, the managed work/material library, and templates.
3. Build a durable pricing draft with source provenance and warnings.
4. Validate the whole draft with the authoritative `internal/calc` kernel.
5. Show the diff and require explicit MCP elicitation confirmation.
6. Apply all operations in one serializable transaction with BOQ audit rows.
7. Generate a direct-price QA report.

The MCP deliberately does not create/delete tenders, import source BOQ files,
change markup tactics, write redistribution results, or approve financials.

## Documents

- [INSTALL.md](INSTALL.md) — staged installation and OAuth connection.
- [VERIFY.md](VERIFY.md) — acceptance gates and smoke checks.
- [ROLLBACK.md](ROLLBACK.md) — safe disable/revert sequence.
- [SECURITY.md](SECURITY.md) — trust boundaries and secret handling.
- [CODEX_INSTALL_PROMPT.md](CODEX_INSTALL_PROMPT.md) — ready prompt for a colleague's Codex.
- [MIGRATION_MANIFEST.md](MIGRATION_MANIFEST.md) — database objects and ordering.
- [TEST_REPORT.md](TEST_REPORT.md) — factual local test evidence and external gates.
