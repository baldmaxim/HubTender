# 15. AUDIT FK SCHEMA DECISION — `boq_items_audit.boq_item_id`

> Read-only diagnostic + decision. No DSN/secret printed. No data changed.
> Source = PROD Supabase (pooler) only; Yandex via verify-full. OLD not used.

- Run (UTC): 2026-05-17

## 1. Why the real import failed

`04_import_yandex` stopped on `public.boq_items_audit` with
`boq_items_audit_boq_item_id_fkey` foreign-key violation. `boq_items_audit` is
historical/audit storage: DELETE-history rows intentionally survive the
deletion of their parent `boq_items` row.

## 2. Diagnostic results

### PROD Supabase — `public.boq_items_audit` foreign keys
| conname | contype | convalidated | cols | references | ON DELETE | ON UPDATE |
|---|---|---|---|---|---|---|
| `boq_items_audit_changed_by_fkey` | f | true | `changed_by` | `users` | SET NULL | NO ACTION |

**There is NO foreign key on `boq_items_audit.boq_item_id` in PROD Supabase.**
The only FK is `changed_by → users`. PROD never enforced a
`boq_item_id → boq_items` relationship — that is why 157 730 orphan audit rows
exist there legitimately.

### PROD audit baseline
- total audit rows: **388 598**
- orphan rows (`boq_item_id` not in `boq_items`): **157 730**
- distinct orphan `boq_item_id`: **66 639**
- indexes: `boq_items_audit_pkey`, `idx_boq_items_audit_item_date`, `idx_boq_items_audit_changed_by`

### Yandex (current cleaned schema, applied)
| conname | cols | references | ON DELETE |
|---|---|---|---|
| `boq_items_audit_boq_item_id_fkey` | `boq_item_id` | `boq_items` | **CASCADE** |
| `boq_items_audit_changed_by_fkey` | `changed_by` | `users` | NO ACTION |

- `boq_items_audit` rows: **0** (import stopped before this table)
- `boq_items` rows: 113 134; current orphan: 0 (audit empty)
- indexes: `boq_items_audit_pkey`, `idx_boq_items_audit_item_date`, `idx_boq_items_audit_changed_by`

## 3. Root cause

The baseline migration `supabase/migrations/00000000000003_*` declared
`boq_items_audit_boq_item_id_fkey (boq_item_id → boq_items ON DELETE CASCADE)`,
and the cleaned Yandex schema (`db/yandex/sql/06_indexes_constraints.sql`)
carried it forward as an enforced, validated FK. **Live PROD does not have this
FK.** It is a schema-fidelity gap: an enforced FK is incompatible with audit
DELETE-history semantics and does not exist in the real source.

## 4. Decision

1. **Remove** `boq_items_audit_boq_item_id_fkey` from the cleaned Yandex
   schema (`db/yandex/sql/06_indexes_constraints.sql`). Keep the supporting
   index `idx_boq_items_audit_boq_item_id` (lookup performance only).
2. A `NOT VALID` FK is explicitly rejected: it still enforces NEW inserts and
   would fail the audit import the same way.
3. Integrity of `boq_items_audit` is verified by an **audit-history check**
   (total / orphan / distinct-orphan counts compared to the PROD baseline
   above), NOT by FK enforcement (`05_verify_yandex`).
4. `02_verify_schema` / `04_import_yandex` treat the **absence** of this FK as
   OK and the **presence** of an enforced FK as a failure (run the schema
   repair first).
5. The already-applied Yandex schema is fixed by a controlled, gated repair
   script (`10_repair_yandex_schema_audit_fk.mjs`): drop the constraint, ensure
   the index. Real repair is operator-gated (`ALLOW_REPAIR_YANDEX_SCHEMA=true`
   + `--apply`).
6. `PK` and all other FKs are preserved. No business data changed.

## 5. Secondary observation (not in scope; flagged)

`boq_items_audit_changed_by_fkey` ON DELETE rule differs: PROD = **SET NULL**,
Yandex cleaned schema = **NO ACTION**. This did not affect the import. Recorded
for a future schema-fidelity pass; not modified by this repair.

## Final status

```
AUDIT_FK_DECISION_RECORDED
```
