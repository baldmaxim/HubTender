begin;

-- Fix: notes on cost-category HEADERS (main rows) silently failed to save on the
-- "Сравнение затрат" (ObjectComparison) page, while detail-level notes saved fine.
--
-- Root cause:
--   public.comparison_notes has a UNIQUE index on
--     (tender_id_1, tender_id_2, cost_category_name, detail_category_key)
--   with the default NULLS DISTINCT semantics. Header notes store
--   detail_category_key = NULL. In PostgreSQL NULLs are distinct in a unique
--   index, so the backend's `INSERT ... ON CONFLICT (...) DO UPDATE`
--   (repository/comparison.go UpsertNotePair) never detected a conflict for
--   header notes and inserted a NEW duplicate row on every edit instead of
--   updating. On reload fetchNotes() collapsed duplicates into a Map in
--   arbitrary row order, so a STALE duplicate could win and the latest edit
--   appeared lost. Detail notes (non-null key) upserted correctly (0 duplicates).
--
-- This script:
--   1. De-duplicates the accumulated NULL-key rows, keeping the most recently
--      updated note per (tender_id_1, tender_id_2, cost_category_name).
--      Both pair orientations (t1,t2) and (t2,t1) are preserved — the grouping
--      keys them separately, matching how the app stores both orientations.
--   2. Replaces the unique constraint with a NULLS NOT DISTINCT variant so that
--      NULL == NULL and the existing ON CONFLICT upsert updates header notes in
--      place (no app code change required). Yandex Managed PostgreSQL 17 supports
--      UNIQUE NULLS NOT DISTINCT.

-- 1. De-duplicate NULL-key (header) rows: delete all but the newest per group.
delete from public.comparison_notes a
using public.comparison_notes b
where a.detail_category_key is null
  and b.detail_category_key is null
  and a.tender_id_1 = b.tender_id_1
  and a.tender_id_2 = b.tender_id_2
  and a.cost_category_name = b.cost_category_name
  and (
    coalesce(a.updated_at, a.created_at) < coalesce(b.updated_at, b.created_at)
    or (
      coalesce(a.updated_at, a.created_at) = coalesce(b.updated_at, b.created_at)
      and a.id < b.id
    )
  );

-- 2. Swap the unique constraint to NULLS NOT DISTINCT.
--    The backend's ON CONFLICT infers the arbiter by column list, not by name,
--    so reusing the same constraint name keeps everything working.
alter table public.comparison_notes
  drop constraint comparison_notes_tender_id_1_tender_id_2_cost_category_name_key;

alter table public.comparison_notes
  add constraint comparison_notes_tender_id_1_tender_id_2_cost_category_name_key
  unique nulls not distinct (tender_id_1, tender_id_2, cost_category_name, detail_category_key);

commit;
