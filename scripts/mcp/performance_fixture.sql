-- Disposable performance-test database only. Requires evaluation_fixture.sql.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.material_names(id,name,unit)
VALUES ('eeeeeeee-8000-0000-0000-000000000001','Бетонный блок массовый','шт') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenders(id,title,client_name,tender_number,version,is_archived,created_at,updated_at)
VALUES ('eeeeeeee-8000-0000-0000-000000000002','MCP PERF NOISE','Eval','EVAL-PERF',1,true,now(),now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.client_positions(id,tender_id,position_number,unit_code,volume,work_name,hierarchy_level)
VALUES ('eeeeeeee-8000-0000-0000-000000000003','eeeeeeee-8000-0000-0000-000000000002',1,'шт',100000,'Массовая шумовая позиция',0) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.boq_items DISABLE TRIGGER USER;
INSERT INTO public.boq_items(tender_id,client_position_id,sort_number,boq_item_type,material_type,material_name_id,unit_code,quantity,unit_rate,currency_type,total_amount)
SELECT 'eeeeeeee-8000-0000-0000-000000000002','eeeeeeee-8000-0000-0000-000000000003',g,'мат','основн.','eeeeeeee-8000-0000-0000-000000000001','шт',1,1,'RUB',1
FROM generate_series(1,100000) g;
ALTER TABLE public.boq_items ENABLE TRIGGER USER;
COMMIT;
ANALYZE public.boq_items;
ANALYZE public.material_names;
ANALYZE public.client_positions;

