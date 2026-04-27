-- Найти оставшийся элемент с NULL commercial полями
SELECT
  bi.id,
  bi.boq_item_type,
  bi.material_type,
  bi.total_amount as base,
  bi.total_commercial_material_cost as mat,
  bi.total_commercial_work_cost as work,
  cp.position_number,
  cp.work_name
FROM boq_items bi
JOIN client_positions cp ON bi.client_position_id = cp.id
WHERE cp.tender_id = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe'
  AND (bi.total_commercial_material_cost IS NULL OR bi.total_commercial_work_cost IS NULL);
