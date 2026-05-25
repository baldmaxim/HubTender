-- =============================================================================
-- 2026_05_fix_extensions_schema_defaults.sql
--
-- Цель: убрать ссылки на схему `extensions` в column-defaults живой Yandex-БД.
--
-- Причина: schema-qualified Supabase-вызовы (`extensions.uuid_generate_v4()`)
-- остались после дампа из старого Supabase prod. Каноничная схема
-- (db/yandex/sql/03_tables.sql) уже использует `gen_random_uuid()`, но
-- `CREATE TABLE IF NOT EXISTS` не перезаписывает defaults на уже существующих
-- таблицах — поэтому на проде они остались битыми.
--
-- Симптом: любой INSERT без явного `id` в публичные таблицы падает с
--   ERROR: schema "extensions" does not exist
-- Пример проявления: POST /api/v1/tenders/{id}/versions/clone → 500
-- (функция `public.clone_tender_as_new_version` делает INSERT'ы без id).
--
-- Безопасность: меняем только DEFAULT, существующие строки не трогаем.
-- ALTER ... SET DEFAULT — no-op, если выражение уже корректно.
-- Идемпотентно. Безопасно гонять повторно.
--
-- Блокировки: каждый ALTER берёт AccessExclusiveLock на таблицу на доли
-- миллисекунды (правка только pg_attrdef, данных не касается).
-- =============================================================================

BEGIN;

ALTER TABLE public.boq_items                        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.boq_items_audit                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.client_positions                 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.comparison_notes                 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.construction_cost_volumes        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.construction_scopes              ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.cost_categories                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.cost_redistribution_results      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.detail_cost_categories           ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.import_sessions                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.library_folders                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.markup_parameters                ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.markup_tactics                   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.material_names                   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.materials_library                ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.notifications                    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.project_additional_agreements    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.project_monthly_completion       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.projects                         ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.subcontract_growth_exclusions    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.template_items                   ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.templates                        ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_documents                 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_group_members             ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_groups                    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_insurance                 ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_iterations                ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_markup_percentage         ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_notes                     ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_pricing_distribution      ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_registry                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tender_statuses                  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tenders                          ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.user_position_filters            ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.user_tasks                       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.users                            ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.work_names                       ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.works_library                    ALTER COLUMN id SET DEFAULT gen_random_uuid();

COMMIT;

-- =============================================================================
-- Read-only контроль (после применения должно быть 0 строк):
--
--   SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
--          pg_get_expr(d.adbin, d.adrelid) AS default_expr
--   FROM   pg_attrdef d
--   JOIN   pg_attribute a ON a.attnum = d.adnum AND a.attrelid = d.adrelid
--   JOIN   pg_class     c ON c.oid    = d.adrelid
--   JOIN   pg_namespace n ON n.oid    = c.relnamespace
--   WHERE  n.nspname = 'public'
--     AND  pg_get_expr(d.adbin, d.adrelid) ILIKE '%extensions.%'
--   ORDER  BY 1,2,3;
--
-- На всякий — функции/view со ссылками на extensions.* (тоже должно быть пусто
-- по public-схеме):
--
--   SELECT n.nspname, p.proname
--   FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE  pg_get_functiondef(p.oid) ILIKE '%extensions.%'
--     AND  n.nspname NOT IN ('pg_catalog','information_schema','extensions');
-- =============================================================================
