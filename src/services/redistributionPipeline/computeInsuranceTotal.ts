import type { InsuranceData } from '../../lib/api/insurance';

// Канонический источник формулы Tender Insurance.
// (apt + park + stor) × judicial_pct/100 × total_pct/100
// Используется в CostRedistribution, Commerce, FinancialIndicators и обоих Excel.
export function computeInsuranceTotal(data: InsuranceData | null | undefined): number {
  if (!data) return 0;
  const apt = (data.apt_price_m2 || 0) * (data.apt_area || 0);
  const park = (data.parking_price_m2 || 0) * (data.parking_area || 0);
  const stor = (data.storage_price_m2 || 0) * (data.storage_area || 0);
  return (apt + park + stor) * ((data.judicial_pct || 0) / 100) * ((data.total_pct || 0) / 100);
}
