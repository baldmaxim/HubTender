// Типы страницы «Финансовые показатели».
// IndicatorRow реэкспортируется из hooks/useFinancialCalculations для
// обратной совместимости импортов (useFinancialData и компоненты).

export interface IndicatorRow {
  key: string;
  row_number: number;
  indicator_name: string;
  coefficient?: string;
  sp_cost?: number;
  customer_cost?: number;
  total_cost?: number;
  is_header?: boolean;
  is_total?: boolean;
  is_yellow?: boolean;
  tooltip?: string;
  // Отступ (подстрока прямых затрат). Раньше определялся по диапазону
  // row_number 2..7; вынесен во флаг, чтобы разбиение строк не ломало вёрстку.
  is_indented?: boolean;
  // Роль строки для генерации Excel-формул (=база × коэффициент). Только у
  // таблицы; см. utils/buildTableRows.ts и utils/exportToExcel.ts.
  calc_key?: string;
  // Числовой процент наценки (для Excel-ячейки коэффициента и формулы). Только
  // у строк-наценок.
  coeff_pct?: number;
  // Промежуточные расчеты для роста стоимости
  works_su10_growth?: number;
  materials_su10_growth?: number;
  works_sub_growth?: number;
  materials_sub_growth?: number;
}

// Сырые суммы прямых затрат по типам BOQ-элементов (нужны и формулам,
// и тултипам строк).
export interface DirectCostTotals {
  subcontractWorks: number;
  subcontractMaterials: number;
  // Субподряд для расчёта роста — с учётом исключений категорий
  subcontractWorksForGrowth: number;
  subcontractMaterialsForGrowth: number;
  works: number;
  materials: number;
  materialsComp: number;
  worksComp: number;
  // Разбивка материалов по material_type (осн./вспом.) — для тултипов таблицы
  // и строки «Материалы». Партиция: materials = materialsBasic + materialsAux,
  // subcontractMaterials = subcontractMaterialsBasic + subcontractMaterialsAux.
  // null material_type трактуется как осн.
  materialsBasic: number;
  materialsAux: number;
  subcontractMaterialsBasic: number;
  subcontractMaterialsAux: number;
  // Разбивка growth-базы субподряд-материалов (с учётом исключений категорий)
  // по осн./вспом. — для тултипа строки «Материалы субподряд рост».
  subcontractMaterialsForGrowthBasic: number;
  subcontractMaterialsForGrowthAux: number;
  // Суммы коммерческих стоимостей из boq_items (кросс-чек с Commerce)
  totalCommercialMaterial: number;
  totalCommercialWork: number;
}

// Разрешённые коэффициенты наценок тендера (проценты) + признак НДС в конструкторе.
export interface MarkupCoefficients {
  mechanizationCoeff: number;
  mvpGsmCoeff: number;
  warrantyCoeff: number;
  coefficient06: number;
  worksCostGrowth: number;
  materialCostGrowth: number;
  subcontractWorksCostGrowth: number;
  subcontractMaterialsCostGrowth: number;
  overheadOwnForcesCoeff: number;
  overheadSubcontractCoeff: number;
  generalCostsCoeff: number;
  profitOwnForcesCoeff: number;
  profitSubcontractCoeff: number;
  unforeseeableCoeff: number;
  vatCoeff: number;
  isVatInConstructor: boolean;
}

// Все промежуточные значения формульного расчёта — вход для билдера строк.
export interface FinancialCalcResult {
  subcontractTotal: number;
  su10Total: number;
  reserveForDeliveryTotal: number;
  directCostsTotal: number;
  directCostsRowTotal: number;
  worksSu10Only: number;
  mechanizationCost: number;
  coefficient06Cost: number;
  mvpGsmCost: number;
  warrantyCost: number;
  worksWithMarkup: number;
  worksCostGrowthAmount: number;
  materialCostGrowthAmount: number;
  subcontractWorksCostGrowthAmount: number;
  subcontractMaterialsCostGrowthAmount: number;
  totalCostGrowth: number;
  baseForUnforeseeable: number;
  unforeseeableCost: number;
  baseForOOZ: number;
  overheadOwnForcesCost: number;
  subcontractGrowth: number;
  baseForSubcontractOOZ: number;
  overheadSubcontractCost: number;
  baseForOFZ: number;
  generalCostsCost: number;
  baseForProfit: number;
  profitOwnForcesCost: number;
  baseForSubcontractProfit: number;
  profitSubcontractCost: number;
  insuranceCost: number;
  grandTotalBeforeVAT: number;
  vatCost: number;
  grandTotal: number;
}
