-- =============================================================================
-- 2026_06_tender_scoped_pgnotify.sql — realtime fan-out for tender-scoped tables.
--
-- SCOPE: adds pg_notify triggers on tables that carry a tender_id column but had
-- NO trigger, so the Go BFF WebSocket hub now pushes live updates to the
-- `tender:<tender_id>` topic when these rows change. Previously other viewers
-- (and even the same user's other tabs) saw changes only after a manual reload.
--
--   tender_markup_percentage     → наценки (FinancialIndicators, MarkupPercentages)
--   tender_pricing_distribution  → распределение затрат (MarkupConstructor)
--   tender_insurance             → страховка тендера (Insurance)
--   tender_notes                 → заметки по тендеру
--   tender_documents             → документы тендера
--   subcontract_growth_exclusions→ исключения роста субподряда
--
-- All six carry tender_id directly → they fall into the generic branch of
-- public.notify_row_change() (db/yandex/sql/07_pgnotify.sql), which already
-- extracts tender_id. The broker's default routing maps the event to
-- `tender:<tender_id>` with NO backend change required.
--
-- The function itself is unchanged here; it is defined canonically in
-- db/yandex/sql/07_pgnotify.sql (and was last modified by
-- db/yandex/incremental/2026_06_timeline_pgnotify.sql). This file only attaches
-- triggers. Idempotent: DROP/CREATE TRIGGER.
--
-- Transaction wrapping (BEGIN/COMMIT) is performed by the apply script,
-- matching the convention of db/yandex/sql/*.sql.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_notify_row_change_tender_markup_percentage      ON public.tender_markup_percentage;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_pricing_distribution   ON public.tender_pricing_distribution;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_insurance              ON public.tender_insurance;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_notes                  ON public.tender_notes;
DROP TRIGGER IF EXISTS trg_notify_row_change_tender_documents              ON public.tender_documents;
DROP TRIGGER IF EXISTS trg_notify_row_change_subcontract_growth_exclusions ON public.subcontract_growth_exclusions;

CREATE TRIGGER trg_notify_row_change_tender_markup_percentage
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_markup_percentage
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_pricing_distribution
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_pricing_distribution
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_insurance
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_insurance
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_notes
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_notes
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_tender_documents
    AFTER INSERT OR UPDATE OR DELETE ON public.tender_documents
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();

CREATE TRIGGER trg_notify_row_change_subcontract_growth_exclusions
    AFTER INSERT OR UPDATE OR DELETE ON public.subcontract_growth_exclusions
    FOR EACH ROW EXECUTE FUNCTION public.notify_row_change();
