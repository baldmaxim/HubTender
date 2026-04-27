-- Шаг 1: Проверить существующие constraints
SELECT
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.boq_items_audit'::regclass;

-- Шаг 2: Удалить старые constraints (выполнить после проверки шага 1)
-- Раскомментируйте и выполните только если constraints существуют:

-- ALTER TABLE public.boq_items_audit
--   DROP CONSTRAINT boq_items_audit_boq_item_id_fkey;

-- ALTER TABLE public.boq_items_audit
--   DROP CONSTRAINT boq_items_audit_changed_by_fkey;

-- Шаг 3: Добавить правильные constraints
-- ALTER TABLE public.boq_items_audit
--   ADD CONSTRAINT boq_items_audit_boq_item_id_fkey
--   FOREIGN KEY (boq_item_id)
--   REFERENCES public.boq_items(id)
--   ON DELETE CASCADE;

-- ALTER TABLE public.boq_items_audit
--   ADD CONSTRAINT boq_items_audit_changed_by_fkey
--   FOREIGN KEY (changed_by)
--   REFERENCES public.users(id)
--   ON DELETE SET NULL;
