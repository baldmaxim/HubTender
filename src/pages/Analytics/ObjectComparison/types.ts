export type CostType = 'base' | 'commercial';
export type ViewMode = 'detailed' | 'simplified';

export interface TenderCosts {
  materials: number;
  works: number;
  total: number;
  mat_per_unit: number;
  work_per_unit: number;
  total_per_unit: number;
  volume: number;
  /**
   * ₽ на м² общей площади по СП (`tenders.area_sp`) — второй показатель, по
   * которому объекты сравниваются между собой. В отличие от `total_per_unit`
   * знаменатель один на весь тендер, поэтому строки сопоставимы между
   * категориями с разными единицами объёма.
   *
   * 0, если площадь по СП у тендера не заполнена.
   */
  total_per_sp: number;
}

/** Строка BOQ в том виде, в каком её потребляет сборка иерархии сравнения. */
export interface BoqItemForComparison {
  total_amount: number | null;
  boq_item_type: string | null;
  total_commercial_material_cost: number | null;
  total_commercial_work_cost: number | null;
  detail_cost_category_id: string | null;
  detail_cost_categories: {
    name: string | null;
    location: string | null;
    cost_categories: { name: string | null } | null;
  } | null;
  client_positions: { tender_id: string } | null;
}

/** Объёмы тендера из construction_cost_volumes: по детализациям и по группам. */
export interface VolumeMaps {
  detailMap: Map<string, number>;
  groupMap: Map<string, number>;
}

/** Примечания инженеров по ключу строки сравнения. */
export type NotesMap = Map<string, string>;

export interface ComparisonRow {
  key: string;
  category: string;
  is_main_category?: boolean;
  // Промежуточный уровень «локализация» между категорией и детализацией.
  // Сейчас используется только для категорий «отделочные работы» и
  // «двери/люки/ворота» — по аналогии со страницей «Затраты на строительство».
  is_location?: boolean;
  // Над-группа над категориями (ВНУТРЕННИЕ ИНЖЕНЕРНЫЕ СИСТЕМЫ), объединяющая
  // несколько отдельных cost_categories (ВИС / …).
  is_super_group?: boolean;
  tenders: TenderCosts[];
  note?: string | null;
  mainCategoryName?: string;
  children?: ComparisonRow[];
}
