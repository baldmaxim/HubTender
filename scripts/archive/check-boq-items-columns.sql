-- Проверка реальной структуры таблицы boq_items

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'boq_items'
ORDER BY ordinal_position;
