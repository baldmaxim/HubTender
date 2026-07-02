import type { BoqItemType } from './enums';

// =============================================
// Типы для таблицы markup_parameters (справочник параметров наценок)
// =============================================

export interface MarkupParameterInsert {
  key: string;
  label: string;
  is_active?: boolean;
  order_num?: number;
  default_value?: number;
}

export interface MarkupParameter extends MarkupParameterInsert {
  id: string;
  created_at: string;
  updated_at: string;
  default_value: number;
}

// =============================================
// Типы для таблицы tender_markup_percentage
// =============================================

export interface TenderMarkupPercentageInsert {
  tender_id: string;
  markup_parameter_id: string;
  value: number;
}

export interface TenderMarkupPercentage extends TenderMarkupPercentageInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенный тип с данными параметра наценки
export interface TenderMarkupPercentageFull extends TenderMarkupPercentage {
  markup_parameter: MarkupParameter;
}

// Вспомогательный тип для UI - данные наценок с ключами параметров
export interface TenderMarkupPercentageUI {
  tender_id: string;
  [key: string]: number | string; // динамические ключи параметров
}

// =============================================
// Markup Tactics (Тактики наценок)
// =============================================

// Структура шага наценки
export interface MarkupStep {
  name?: string; // Название пункта
  baseIndex: number; // -1 для базовой стоимости, или индекс пункта в массиве

  // Первая операция (обязательная)
  action1: 'multiply' | 'divide' | 'add' | 'subtract';
  operand1Type: 'markup' | 'step' | 'number'; // наценка, результат другого шага или число
  operand1Key?: string | number; // ключ наценки (если operand1Type = 'markup') или число (если operand1Type = 'number')
  operand1Index?: number; // индекс шага (если operand1Type = 'step')
  operand1MultiplyFormat?: 'addOne' | 'direct'; // формат умножения: 'addOne' = (1 + %), 'direct' = %

  // Вторая операция (опциональная)
  action2?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand2Type?: 'markup' | 'step' | 'number';
  operand2Key?: string | number;
  operand2Index?: number;
  operand2MultiplyFormat?: 'addOne' | 'direct';

  // Третья операция (опциональная)
  action3?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand3Type?: 'markup' | 'step' | 'number';
  operand3Key?: string | number;
  operand3Index?: number;
  operand3MultiplyFormat?: 'addOne' | 'direct';

  // Четвертая операция (опциональная)
  action4?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand4Type?: 'markup' | 'step' | 'number';
  operand4Key?: string | number;
  operand4Index?: number;
  operand4MultiplyFormat?: 'addOne' | 'direct';

  // Пятая операция (опциональная)
  action5?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand5Type?: 'markup' | 'step' | 'number';
  operand5Key?: string | number;
  operand5Index?: number;
  operand5MultiplyFormat?: 'addOne' | 'direct';
}

// Маппинг UI ключей вкладок на boq_item_type
export type TabKey = 'works' | 'materials' | 'subcontract_works' | 'subcontract_materials' | 'work_comp' | 'material_comp';

export const TAB_TO_BOQ_TYPE: Record<TabKey, BoqItemType> = {
  works: 'раб',
  materials: 'мат',
  subcontract_works: 'суб-раб',
  subcontract_materials: 'суб-мат',
  work_comp: 'раб-комп.',
  material_comp: 'мат-комп.',
};

export const BOQ_TYPE_TO_TAB: Record<BoqItemType, TabKey> = {
  'раб': 'works',
  'мат': 'materials',
  'суб-раб': 'subcontract_works',
  'суб-мат': 'subcontract_materials',
  'раб-комп.': 'work_comp',
  'мат-комп.': 'material_comp',
};

// Структура последовательностей наценок (используем boq_item_type)
export interface MarkupSequences {
  'раб': MarkupStep[];
  'мат': MarkupStep[];
  'суб-раб': MarkupStep[];
  'суб-мат': MarkupStep[];
  'раб-комп.': MarkupStep[];
  'мат-комп.': MarkupStep[];
}

// Структура базовых стоимостей (используем boq_item_type)
export interface BaseCosts {
  'раб': number;
  'мат': number;
  'суб-раб': number;
  'суб-мат': number;
  'раб-комп.': number;
  'мат-комп.': number;
}

// Вставка новой тактики
export interface MarkupTacticInsert {
  name?: string;
  sequences: MarkupSequences;
  base_costs: BaseCosts;
  user_id?: string;
  is_global?: boolean;
}

// Полная тактика наценок
export interface MarkupTactic extends MarkupTacticInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы tender_pricing_distribution
// =============================================

export type DistributionTarget = 'material' | 'work';

export interface PricingDistributionInsert {
  tender_id: string;
  markup_tactic_id?: string | null;

  // Основные материалы (мат)
  basic_material_base_target?: DistributionTarget;
  basic_material_markup_target?: DistributionTarget;

  // Вспомогательные материалы (мат-комп.)
  auxiliary_material_base_target?: DistributionTarget;
  auxiliary_material_markup_target?: DistributionTarget;

  // Компонентные материалы (мат-комп.)
  component_material_base_target?: DistributionTarget;
  component_material_markup_target?: DistributionTarget;

  // Субподрядные материалы - основные (суб-мат основные)
  subcontract_basic_material_base_target?: DistributionTarget;
  subcontract_basic_material_markup_target?: DistributionTarget;

  // Субподрядные материалы - вспомогательные (суб-мат вспомогательные)
  subcontract_auxiliary_material_base_target?: DistributionTarget;
  subcontract_auxiliary_material_markup_target?: DistributionTarget;

  // Работы (раб)
  work_base_target?: DistributionTarget;
  work_markup_target?: DistributionTarget;

  // Компонентные работы (раб-комп.)
  component_work_base_target?: DistributionTarget;
  component_work_markup_target?: DistributionTarget;
}

export interface PricingDistribution extends PricingDistributionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Вспомогательный тип для маппинга boq_item_type на ключи правил распределения
export type PricingItemType = 'basic_material' | 'auxiliary_material' | 'subcontract_material' | 'work';

// Функция маппинга boq_item_type на PricingItemType
export function mapBoqItemTypeToPricingType(boqItemType: BoqItemType): PricingItemType {
  switch (boqItemType) {
    case 'мат':
      return 'basic_material';
    case 'мат-комп.':
      return 'auxiliary_material';
    case 'суб-мат':
      return 'subcontract_material';
    case 'раб':
    case 'раб-комп.':
    case 'суб-раб':
      return 'work';
  }
}

// =============================================
// Типы для таблицы subcontract_growth_exclusions
// =============================================

export type SubcontractExclusionType = 'works' | 'materials';

export interface SubcontractGrowthExclusionInsert {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}

export interface SubcontractGrowthExclusion extends SubcontractGrowthExclusionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы cost_redistribution_results
// =============================================

export interface RedistributionRule {
  deductions: Array<{
    level: 'category' | 'detail';
    category_id?: string;
    detail_cost_category_id?: string;
    category_name: string;
    percentage: number;
    boq_item_types?: string[];
  }>;
  targets: Array<{
    level: 'category' | 'detail';
    category_id?: string;
    detail_cost_category_id?: string;
    category_name: string;
  }>;
  // Legacy single-operation form (до поддержки итераций) — читается при загрузке для совместимости.
  position_adjustment?: {
    mode: 'deduct' | 'transfer' | 'add';
    amount: number;
    sourceIds: string[];
    targetIds: string[];
  };
  // Multi-step итерации: массив последовательно применяемых операций.
  position_adjustments?: Array<{
    mode: 'deduct' | 'transfer' | 'add';
    amount: number;
    sourceIds: string[];
    targetIds: string[];
  }>;
}

export interface CostRedistributionResultInsert {
  tender_id: string;
  markup_tactic_id: string;
  boq_item_id: string;
  original_work_cost?: number | null;
  deducted_amount?: number;
  added_amount?: number;
  final_work_cost?: number | null;
  redistribution_rules?: RedistributionRule | null;
  created_by?: string | null;
}

export interface CostRedistributionResult extends CostRedistributionResultInsert {
  id: string;
  created_at: string;
  updated_at: string;
}
