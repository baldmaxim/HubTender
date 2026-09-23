-- Disposable performance-test database only.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.boq_items DISABLE TRIGGER USER;
DELETE FROM public.boq_items WHERE tender_id='eeeeeeee-8000-0000-0000-000000000002';
ALTER TABLE public.boq_items ENABLE TRIGGER USER;
DELETE FROM public.client_positions WHERE tender_id='eeeeeeee-8000-0000-0000-000000000002';
DELETE FROM public.tenders WHERE id='eeeeeeee-8000-0000-0000-000000000002';
DELETE FROM public.material_names WHERE id='eeeeeeee-8000-0000-0000-000000000001';
COMMIT;
