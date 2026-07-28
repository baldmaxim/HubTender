import { useTendersData } from './useTendersData';
import { useFinancialCalculations } from './useFinancialCalculations';

export type { IndicatorRow } from './useFinancialCalculations';

export const useFinancialData = () => {
  const {
    tenders,
    loading: tendersLoading,
    loadTenders,
  } = useTendersData();

  const {
    data,
    tableData,
    spTotal,
    customerTotal,
    loading: calculationsLoading,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    fetchFinancialIndicators,
    discountContext,
    discountSettings,
    getDiscountWorkspace,
  } = useFinancialCalculations();

  return {
    tenders,
    loading: tendersLoading || calculationsLoading,
    data,
    tableData,
    spTotal,
    customerTotal,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    loadTenders,
    fetchFinancialIndicators,
    discountContext,
    discountSettings,
    getDiscountWorkspace,
  };
};
