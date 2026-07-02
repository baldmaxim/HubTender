// Типы страницы «Затраты на строительство» (ConstructionCostNew).
// CostRow/TenderOption реэкспортируются из hooks/useCostData для обратной
// совместимости импортов компонентов страницы.

export interface CostRow {
  key: string;
  detail_cost_category_id?: string;
  cost_category_name: string;
  detail_category_name: string;
  location_name: string;
  volume: number;
  unit: string;
  materials_cost: number;
  works_cost: number;
  sub_materials_cost: number;
  sub_works_cost: number;
  materials_comp_cost: number;
  works_comp_cost: number;
  total_cost: number;
  cost_per_unit: number;
  order_num?: number;
  is_category?: boolean;
  is_location?: boolean;  // Промежуточный уровень группировки по локализации
  is_super_group?: boolean;  // Над-группа над категориями (ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ)
  is_vis_subcategory?: boolean;  // Дочерняя категория над-группы ВИС — без своего фона
  children?: CostRow[];
  notes?: string;
}

export interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

export interface BoqItemForCost {
  detail_cost_category_id: string | null;
  boq_item_type: string | null;
  material_type: string | null;
  quantity: number | null;
  unit_rate: number | null;
  currency_type: string | null;
  delivery_price_type: string | null;
  delivery_amount: number | null;
  consumption_coefficient: number | null;
  parent_work_item_id: string | null;
  total_amount: number | null;
  total_commercial_material_cost: number | null;
  total_commercial_work_cost: number | null;
  client_positions: { tender_id: string } | null;
}

// Суммы затрат по детальной категории (значения costMap).
export interface CostSums {
  materials: number;
  works: number;
  subMaterials: number;
  subWorks: number;
  materialsComp: number;
  worksComp: number;
}
