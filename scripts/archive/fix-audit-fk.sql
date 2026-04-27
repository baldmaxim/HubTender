-- Исправление FK constraint для boq_items_audit

-- 1. Удалить старый неправильный constraint
ALTER TABLE public.boq_items_audit
  DROP CONSTRAINT IF EXISTS boq_items_audit_boq_item_id_fkey;

-- 2. Добавить правильный constraint с CASCADE
ALTER TABLE public.boq_items_audit
  ADD CONSTRAINT boq_items_audit_boq_item_id_fkey
  FOREIGN KEY (boq_item_id)
  REFERENCES public.boq_items(id)
  ON DELETE CASCADE;

-- 3. Также исправить changed_by FK (если нужен)
ALTER TABLE public.boq_items_audit
  DROP CONSTRAINT IF EXISTS boq_items_audit_changed_by_fkey;

ALTER TABLE public.boq_items_audit
  ADD CONSTRAINT boq_items_audit_changed_by_fkey
  FOREIGN KEY (changed_by)
  REFERENCES public.users(id)
  ON DELETE SET NULL;

-- Проверка
SELECT
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.boq_items_audit'::regclass;
