-- Disposable evaluation database only.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.boq_items WHERE id::text LIKE 'eeeeeeee-5000-%';
DELETE FROM public.template_items WHERE id::text LIKE 'eeeeeeee-7100-%';
DELETE FROM public.templates WHERE id::text LIKE 'eeeeeeee-7000-%';
DELETE FROM public.works_library WHERE id::text LIKE 'eeeeeeee-6000-%';
DELETE FROM public.materials_library WHERE id::text LIKE 'eeeeeeee-6000-%';
DELETE FROM public.client_positions WHERE id::text LIKE 'eeeeeeee-4000-%';
DELETE FROM public.tenders WHERE id::text LIKE 'eeeeeeee-3000-%';
DELETE FROM public.work_names WHERE id::text LIKE 'eeeeeeee-2000-%';
DELETE FROM public.material_names WHERE id::text LIKE 'eeeeeeee-1000-%';
DELETE FROM public.detail_cost_categories WHERE id='eeeeeeee-0000-0000-0000-000000000002';
DELETE FROM public.cost_categories WHERE id='eeeeeeee-0000-0000-0000-000000000001';
COMMIT;

