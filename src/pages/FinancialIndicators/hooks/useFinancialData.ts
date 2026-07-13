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
    spTotal,
    customerTotal,
    loading: calculationsLoading,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    fetchFinancialIndicators,
  } = useFinancialCalculations();

  return {
    tenders,
    loading: tendersLoading || calculationsLoading,
    data,
    spTotal,
    customerTotal,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    loadTenders,
    fetchFinancialIndicators,
  };
};
