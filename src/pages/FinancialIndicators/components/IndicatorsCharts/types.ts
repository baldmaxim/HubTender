import type { IndicatorRow } from '../../hooks/useFinancialData';
import type { DiscountContext } from '../../discount/types';

/**
 * Множитель прямых затрат BOQ-элемента после снижения (0..1).
 * Детализация по категориям грузит boq_items своим запросом, поэтому скидку
 * ей надо передать явно — иначе сумма разбивки разойдётся с ИТОГО.
 */
export type BoqItemScale = DiscountContext['itemScale'];

export interface IndicatorsChartsProps {
  data: IndicatorRow[];
  spTotal: number;
  formatNumber: (value: number | undefined) => string;
  selectedTenderId: string | null;
  isVatInConstructor: boolean;
  vatCoefficient: number;
  /** null/undefined — снижение выключено, масштабирование не применяется. */
  itemScale?: BoqItemScale | null;
}

export interface CategoryBreakdown {
  category_name: string;
  detail_name: string;
  location_name: string;
  total_amount: number;
  works_amount: number;
  materials_amount: number;
}

export interface SummaryTableRow {
  key: number;
  indicator_name: string;
  amount: number;
  price_per_m2: number;
}

export interface DrillDownLevel {
  type: 'root' | 'direct_costs' | 'markups' | 'indicator' | 'profit_breakdown' | 'ooz_breakdown' | 'cost_growth_breakdown' | 'reserve_breakdown';
  indicatorName?: string;
  rowNumber?: number;
}

export type TenderRates = {
  usd_rate: number | null;
  eur_rate: number | null;
  cny_rate: number | null;
};

export interface ReferenceInfo {
  monolithPerM3: number;
  visPerM2: number;
  facadePerM2: number;
}
