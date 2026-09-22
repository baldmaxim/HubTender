# Prompt for the colleague's Codex

You are integrating the audited TenderHUB MCP v1 handoff. Work only in the
clean checkout of `https://github.com/baldmaxim/HubTender` supplied by the user.

1. Read `MANIFEST.json`, `INSTALL.md`, `VERIFY.md`, `ROLLBACK.md`, and
   `SHA256SUMS.txt` from the handoff package. Verify every checksum first.
2. Confirm `git status --short` is empty and commit
   `6cbfa9bcd6ca491f7daaa94347d88d2b7236f31f` is an ancestor of HEAD. Stop and
   report exact drift if it is not.
3. Never copy `.env` or credentials from the old Telegram ZIP. Confirm the DB
   password, Sentry token, and app JWT signing key were rotated by the operator;
   do not print their values.
4. Apply `0001-tenderhub-mcp-v1.patch` with `git am --3way`. Resolve no conflict
   by blindly choosing ours/theirs. Preserve all newer TenderHUB subsystems.
5. Run `scripts/mcp/preflight.*`, Go vet/tests/build, npm ci/lint/typecheck/build.
   Stop on any failure.
6. Review the additive SQL migration and apply it only to staging after a DB
   snapshot. Run `scripts/mcp/verify_migration.sql`.
7. Configure MCP from `deploy/mcp.env.example` with write flags false. Install
   the nginx snippet, run `nginx -t`, then deploy staging.
8. Execute the unauthenticated and authenticated smoke tests, OAuth revoke test,
   read-only evaluations, and pricing UAT in `VERIFY.md`.
9. Enable draft writes only after read-only gates pass. Enable template writes
   only after the role-gate UAT passes.
10. Do not deploy production while any gate is red or secret rotation is
    unconfirmed. Return a factual report with commit, commands, timestamps,
    migration checksum, pass/fail table, and remaining blockers.

