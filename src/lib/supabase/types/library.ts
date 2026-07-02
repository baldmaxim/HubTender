import type {
  UnitType,
  MaterialType,
  CurrencyType,
  DeliveryPriceType,
  ItemType,
  WorkItemType,
} from './enums';

// =============================================
// Типы для таблицы materials_library
// =============================================

export interface LibraryFolder {
  id: string;
  name: string;
  type: 'works' | 'materials';
  sort_order: number;
  parent_id: string | null;
  created_at: string;
}

export interface MaterialLibraryInsert {
  material_type: MaterialType;
  item_type: ItemType;
  consumption_coefficient?: number;
  unit_rate: number;
  currency_type?: CurrencyType;
  delivery_price_type?: DeliveryPriceType;
  delivery_amount?: number;
  material_name_id: string;
  folder_id?: string | null;
}

export interface MaterialLibrary extends MaterialLibraryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы material_names
// =============================================

export interface MaterialNameInsert {
  name: string;
  unit: UnitType;
}

export interface MaterialName extends MaterialNameInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы work_names
// =============================================

export interface WorkNameInsert {
  name: string;
  unit: UnitType;
}

export interface WorkName extends WorkNameInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы locations
// =============================================

export interface LocationInsert {
  location: string;
}

export interface Location extends LocationInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы cost_categories
// =============================================

export interface CostCategoryInsert {
  name: string;
  unit: UnitType;
}

export interface CostCategory extends CostCategoryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы detail_cost_categories
// =============================================

export interface DetailCostCategoryInsert {
  cost_category_id: string;
  location_id: string;
  name: string;
  unit: UnitType;
  order_num?: number;
}

export interface DetailCostCategory extends DetailCostCategoryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы construction_cost_volumes
// =============================================

export interface ConstructionCostVolumeInsert {
  tender_id: string;
  detail_cost_category_id: string;
  volume?: number;
}

export interface ConstructionCostVolume extends ConstructionCostVolumeInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Расширенный тип для materials_library с JOIN данными
// =============================================

export interface MaterialLibraryFull extends MaterialLibrary {
  material_name: string;
  unit: UnitType;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы works_library
// =============================================

export interface WorkLibraryInsert {
  work_name_id: string;
  item_type: WorkItemType;
  unit_rate: number;
  currency_type?: CurrencyType;
  folder_id?: string | null;
}

export interface WorkLibrary extends WorkLibraryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Расширенный тип для works_library с JOIN данными
// =============================================

export interface WorkLibraryFull extends WorkLibrary {
  work_name: string;
  unit: UnitType;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы work_material_templates
// =============================================

export interface WorkMaterialTemplateInsert {
  template_name: string;
  detail_cost_category_id: string;
  consumption_coefficient: number;
  work_library_id: string;
  material_library_id: string;
  order_num?: number;
  is_active?: boolean;
}

export interface WorkMaterialTemplate extends WorkMaterialTemplateInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Расширенный тип для work_material_templates с JOIN данными
// =============================================

export interface WorkMaterialTemplateFull extends WorkMaterialTemplate {
  work_name: string;
  work_unit: UnitType;
  work_item_type: WorkItemType;
  work_unit_rate: number;
  work_currency_type: CurrencyType;
  material_name: string;
  material_unit: UnitType;
  material_type: MaterialType;
  material_item_type: ItemType;
  material_unit_rate: number;
  material_currency_type: CurrencyType;
  detail_cost_category_name: string;
  cost_category_name: string;
  location: string;
}

// =============================================
// Типы для таблицы templates
// =============================================

export interface TemplateInsert {
  name: string;
  detail_cost_category_id: string;
}

export interface Template extends TemplateInsert {
  id: string;
  created_at: string;
  updated_at: string;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы template_items
// =============================================

export type TemplateItemKind = 'work' | 'material';

export interface TemplateItemInsert {
  template_id: string;
  kind: TemplateItemKind;
  work_library_id?: string | null;
  material_library_id?: string | null;
  parent_work_item_id?: string | null;
  conversation_coeff?: number | null;
  detail_cost_category_id?: string | null;
  position?: number;
  note?: string | null;
}

export interface TemplateItem extends TemplateItemInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенные типы с JOIN данными
export interface TemplateItemFull extends TemplateItem {
  work_name?: string;
  work_unit?: UnitType;
  material_name?: string;
  material_unit?: UnitType;
  parent_work_name?: string;
  detail_cost_category_name?: string;
  detail_cost_category_full?: string; // Format: "Category / Detail / Location"
}
