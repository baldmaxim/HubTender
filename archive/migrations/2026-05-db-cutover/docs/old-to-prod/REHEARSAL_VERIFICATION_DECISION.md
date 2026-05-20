# Rehearsal Verification Decision — checksum mismatch acceptance

> Generated 2026-05-16. Operator decision record. No data changed. No import /
> repair / clean run to produce this document.

> **⚠ SUPERSEDED 2026-05-17.** §7 below (checksum mismatch blamed on
> pool-safe live writes) is **WRONG**. The strict cutover with OLD **frozen**
> reproduced the identical `client_positions`/`projects` mismatch — so it was
> never source drift. True root cause: node-postgres parsed
> `date`/`timestamp`/`timestamptz` into JS `Date` (−1 day on dates, µs
> truncation on timestamptz). See `docs/old-to-prod/VERIFY_ROOT_CAUSE.md`.
> Consequence: **rehearsal data produced before the temporal-parser fix is
> NOT final-valid** and must NOT seed Yandex. A fresh strict cutover is
> required after the fix (raw parsers + UTC/ISO session) until
> `VERIFY_RESULT.md = VERIFY_OK`. The "accept as WARNING" decision in §8
> applied only to the pre-diagnosis rehearsal and no longer holds.

## Final rehearsal data status: **DATA_REHEARSAL_OK_WITH_WARNINGS**

## 1. VERIFY_RESULT.md currently FAILED — checksum mismatch

`docs/old-to-prod/VERIFY_RESULT.md` = `VERIFY_FAILED`, caused **only** by
server-side md5 checksum mismatch on two tables:

- `public.client_positions`
- `public.projects`

No other check failed.

## 2. Row counts matched

Every imported table: PROD row count == OLD export row count. No missing
rows, no extra rows in business tables.

## 3. duplicate_pk_total = 0

`.old-to-prod-export/export_validation.json` → `duplicate_pk_total: 0`,
`errors: []`, 42 tables validated. Keyset pagination eliminated the earlier
LIMIT/OFFSET drift entirely.

## 4. boq_items_audit consistent

`old=388598 prod=388598 inflation=0`. The `trg_boq_items_audit` trigger was
correctly disabled during import — no audit-row inflation.

## 5. tender_registry duplicates unchanged

Baseline `by_tender_number old=10 prod=10`, `by_title_client_area old=0
prod=0`. `trigger_auto_create_tender_registry` did not fire during import.

## 6. AUTH_VERIFY_RESULT.md = AUTH_VERIFY_OK

auth.users 33=33, auth.identities 4 + 29 bootstrap = 33, passwords
match=33 mismatch=0 (bcrypt byte-identical), NULL token-column audit
total_null=0 (GoTrue schema bug repaired), smoke login OK (OLD user_id ==
PROD user_id `d5309c31-…`).

## 7. Root cause of checksum mismatch

Export ran in **pool-safe mode** (`--pool-safe-export`): per-table fresh
connection, NO `REPEATABLE READ` transaction snapshot, OLD **not frozen**.
Within a single table's export the sequence is three independent statements
on the pool connection:

1. `COUNT(*)`
2. keyset-stream rows → NDJSON
3. `md5(string_agg(t::text, ',' ORDER BY pk))` server-side checksum

OLD received live writes between step 2 and step 3 for `client_positions`
and `projects`. The NDJSON reflects state A; the manifest sql_checksum
reflects state B. Import faithfully loaded state A → PROD == NDJSON == state
A. Verify recomputed PROD checksum and compared to manifest checksum (state
B) → mismatch. **This is not data corruption** — it is a checksum computed
at a marginally different instant than the row dump, on a live source.

## 8. Decision

- **Rehearsal only**: accept the `client_positions` / `projects` checksum
  mismatch as a **WARNING**. Data is internally consistent (row counts,
  PK uniqueness, FK integrity, audit/registry baselines all pass).
- **Production cutover**: this is **NOT acceptable**. A real cutover must
  produce `VERIFY_OK` with byte-consistent checksums.

## 9. Production requirement (before final cutover)

One of:
- Freeze OLD write-path (frontend maintenance / 503 on writes) BEFORE
  `04_export_old`, so no writes occur during the export window; **or**
- Use a `REPEATABLE READ READ ONLY` transaction snapshot via a direct
  connection (`db.<ref>.supabase.co`) that does not share the Supabase
  Session Pooler with live traffic.

Then re-run export → prepare → import → verify until
`VERIFY_RESULT.md = VERIFY_OK`.

## 10. Final rehearsal data status

**`DATA_REHEARSAL_OK_WITH_WARNINGS`**

Data is acceptable as a *rehearsal target* for Go BFF verification. It is
NOT acceptable as the final cutover dataset.

## 11. Yandex migration gate

The Yandex final migration **MUST NOT** start from this rehearsal dataset.
`READY_FOR_YANDEX_MIGRATION` requires a strict `VERIFY_OK` produced from a
frozen/snapshot-consistent export. Until then Yandex cutover is **blocked**.

## 12. Go BFF verification scope

PROD Go BFF verification **may run now**, but only as **rehearsal
verification**. Its best achievable status is `READY_WITH_WARNINGS` (never
`READY_FOR_YANDEX_MIGRATION`) precisely because `VERIFY_RESULT.md` is not
`VERIFY_OK`.
