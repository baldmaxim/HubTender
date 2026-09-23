# TenderHUB MCP read-only evaluation

The XML answers are tied to `scripts/mcp/evaluation_fixture.sql`. Apply the
fixture only to an isolated/disposable staging database, connect an approved
test OAuth user, run the evaluation against `/mcp`, then remove the fixture
with `scripts/mcp/evaluation_cleanup.sql`.

Every question is independent and read-only. Do not run the fixture or the
evaluation against production customer data.

