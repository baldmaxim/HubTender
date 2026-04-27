-- Удаление системы аудита BOQ items

-- 1. Удалить триггер
DROP TRIGGER IF EXISTS boq_items_audit_trigger ON public.boq_items;

-- 2. Удалить функцию
DROP FUNCTION IF EXISTS public.log_boq_items_changes();

-- 3. Удалить таблицу аудита
DROP TABLE IF EXISTS public.boq_items_audit CASCADE;

-- Проверка
SELECT 'Система аудита удалена' as status;
