-- Baseline migration 7/10: views.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- Fix applied: WITH (security_invoker = true) on both views (was SECURITY DEFINER in live prod).

CREATE OR REPLACE VIEW public.materials_library_full_view
  WITH (security_invoker = true)
AS
SELECT
  m.id,
  m.material_type,
  m.item_type,
  mn.name AS material_name,
  mn.unit,
  m.consumption_coefficient,
  m.unit_rate,
  m.currency_type,
  m.delivery_price_type,
  m.delivery_amount,
  m.created_at,
  m.updated_at
FROM public.materials_library m
JOIN public.material_names mn ON m.material_name_id = mn.id;

CREATE OR REPLACE VIEW public.works_library_full_view
  WITH (security_invoker = true)
AS
SELECT
  w.id,
  w.item_type,
  wn.name AS work_name,
  wn.unit,
  w.unit_rate,
  w.currency_type,
  w.created_at,
  w.updated_at
FROM public.works_library w
JOIN public.work_names wn ON w.work_name_id = wn.id;
