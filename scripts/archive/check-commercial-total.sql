-- Проверка коммерческой суммы для тендера ЖК События 6.2
-- Tender ID: b307b7d5-b145-4d06-a92e-8d1d50a6befe

-- 1. Прямая сумма из boq_items
SELECT
  COUNT(*) as items_count,
  SUM(total_commercial_material_cost) as total_mat,
  SUM(total_commercial_work_cost) as total_work,
  SUM(total_commercial_material_cost + total_commercial_work_cost) as commercial_total
FROM boq_items
WHERE tender_id = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';
