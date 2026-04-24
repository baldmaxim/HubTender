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
}

export interface ComparisonRow {
  key: string;
  category: string;
  is_main_category?: boolean;
  // Промежуточный уровень «локализация» между категорией и детализацией.
  // Сейчас используется только для категорий «отделочные работы» и
  // «двери/люки/ворота» — по аналогии со страницей «Затраты на строительство».
  is_location?: boolean;
  tenders: TenderCosts[];
  note?: string | null;
  mainCategoryName?: string;
  children?: ComparisonRow[];
}
