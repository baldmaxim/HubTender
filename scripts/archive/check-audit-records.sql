-- Проверка записей аудита

-- 1. Последние 20 записей DELETE операций
SELECT
  id,
  boq_item_id,
  operation_type,
  changed_at,
  changed_by,
  old_data->>'boq_item_type' as item_type,
  old_data->>'total_amount' as amount
FROM boq_items_audit
WHERE operation_type = 'DELETE'
ORDER BY changed_at DESC
LIMIT 20;

-- 2. Все операции за последний час
SELECT
  operation_type,
  COUNT(*) as count,
  MAX(changed_at) as last_operation
FROM boq_items_audit
WHERE changed_at > NOW() - INTERVAL '1 hour'
GROUP BY operation_type;

-- 3. Проверка триггера
SELECT
  tgname as trigger_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as definition
FROM pg_trigger
WHERE tgrelid = 'public.boq_items'::regclass
  AND tgname = 'boq_items_audit_trigger';
