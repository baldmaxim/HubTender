// UI display / Excel-export only — the FinancialIndicators grand-total cascade is
// rendered and exported, never POSTed/persisted. Authoritative money math is
// backend/internal/calc. See docs/CALCULATION_SOURCE_OF_TRUTH.md.
import type { DirectCostTotals, MarkupCoefficients, FinancialCalcResult } from '../types';

/**
 * Формульный расчёт финансовых показателей (строки 1-18) из прямых затрат
 * и коэффициентов наценок. Перенесено из useFinancialCalculations без
 * изменений логики; console.log — намеренные кросс-чеки.
 */
export const computeIndicators = (
  totals: DirectCostTotals,
  coeffs: MarkupCoefficients,
  insuranceCost: number,
): FinancialCalcResult => {
  const {
    subcontractWorks,
    subcontractMaterials,
    subcontractWorksForGrowth,
    subcontractMaterialsForGrowth,
    works,
    materials,
    materialsComp,
    worksComp,
    totalCommercialMaterial,
    totalCommercialWork,
  } = totals;
  const {
    mechanizationCoeff,
    mvpGsmCoeff,
    warrantyCoeff,
    coefficient06,
    worksCostGrowth,
    materialCostGrowth,
    subcontractWorksCostGrowth,
    subcontractMaterialsCostGrowth,
    overheadOwnForcesCoeff,
    overheadSubcontractCoeff,
    generalCostsCoeff,
    profitOwnForcesCoeff,
    profitSubcontractCoeff,
    unforeseeableCoeff,
    vatCoeff,
    isVatInConstructor,
  } = coeffs;

  console.log('Works (раб):', works);
  console.log('WorksComp (раб-комп.):', worksComp);
  console.log('WorksSu10Only base:', works + worksComp);
  console.log('Calculated 0,6к cost:', (works + worksComp) * (coefficient06 / 100));
  console.log('=========================');

  // Итоговые значения прямых затрат (без коррекции — total_amount в BOQ это базовая стоимость)
  const subcontractTotal = subcontractWorks + subcontractMaterials;
  const su10Total = works + materials; // Без comp-элементов
  const reserveForDeliveryTotal = materialsComp + worksComp; // Запас на сдачу объекта
  const directCostsTotal = subcontractTotal + su10Total + reserveForDeliveryTotal;

  console.log('Итоговые ПЗ после коррекции:', { subcontractTotal, su10Total, reserveForDeliveryTotal, directCostsTotal });

  const worksSu10Only = works;
  const mechanizationCost = worksSu10Only * (mechanizationCoeff / 100);
  const coefficient06Cost = (worksSu10Only + mechanizationCost) * (coefficient06 / 100);
  const mvpGsmCost = worksSu10Only * (mvpGsmCoeff / 100);
  const warrantyCost = worksSu10Only * (warrantyCoeff / 100);

  // Прямые затраты (строка 1) включают также СМ + МБП+ГСМ + Гарантию (строки 5-7),
  // как уже считают диаграммы. directCostsTotal не трогаем — он нужен в grandTotal.
  const directCostsRowTotal = directCostsTotal + mechanizationCost + mvpGsmCost + warrantyCost;

  const worksWithMarkup = worksSu10Only + coefficient06Cost + mvpGsmCost + mechanizationCost;
  const worksCostGrowthAmount = worksWithMarkup * (worksCostGrowth / 100);
  const materialCostGrowthAmount = materials * (materialCostGrowth / 100);
  // Используем отфильтрованные суммы для расчета роста субподряда
  const subcontractWorksCostGrowthAmount = subcontractWorksForGrowth * (subcontractWorksCostGrowth / 100);
  const subcontractMaterialsCostGrowthAmount = subcontractMaterialsForGrowth * (subcontractMaterialsCostGrowth / 100);

  const totalCostGrowth = worksCostGrowthAmount +
                          materialCostGrowthAmount +
                          subcontractWorksCostGrowthAmount +
                          subcontractMaterialsCostGrowthAmount;

  const baseForUnforeseeable = worksSu10Only + coefficient06Cost + materials + mvpGsmCost + mechanizationCost;
  const unforeseeableCost = baseForUnforeseeable * (unforeseeableCoeff / 100);

  const baseForOOZ = baseForUnforeseeable + worksCostGrowthAmount + materialCostGrowthAmount + unforeseeableCost;
  const overheadOwnForcesCost = baseForOOZ * (overheadOwnForcesCoeff / 100);

  const subcontractGrowth = subcontractWorksCostGrowthAmount + subcontractMaterialsCostGrowthAmount;
  const baseForSubcontractOOZ = subcontractTotal + subcontractGrowth;
  const overheadSubcontractCost = baseForSubcontractOOZ * (overheadSubcontractCoeff / 100);

  const baseForOFZ = baseForOOZ + overheadOwnForcesCost;
  const generalCostsCost = baseForOFZ * (generalCostsCoeff / 100);

  const baseForProfit = baseForOFZ + generalCostsCost;
  const profitOwnForcesCost = baseForProfit * (profitOwnForcesCoeff / 100);

  const baseForSubcontractProfit = baseForSubcontractOOZ + overheadSubcontractCost;
  const profitSubcontractCost = baseForSubcontractProfit * (profitSubcontractCoeff / 100);

  const grandTotalBeforeVAT = directCostsTotal +
                    mechanizationCost +
                    mvpGsmCost +
                    warrantyCost +
                    coefficient06Cost +
                    totalCostGrowth +
                    unforeseeableCost +
                    overheadOwnForcesCost +
                    overheadSubcontractCost +
                    generalCostsCost +
                    profitOwnForcesCost +
                    profitSubcontractCost +
                    insuranceCost;

  // Условный расчет НДС в зависимости от наличия НДС в конструкторе наценок
  let vatCost: number;
  let grandTotal: number;

  if (isVatInConstructor) {
    // НДС есть в конструкторе - добавляем НДС сверху к сумме строк 1-14
    vatCost = grandTotalBeforeVAT * (vatCoeff / 100);
    grandTotal = grandTotalBeforeVAT + vatCost;
  } else {
    // НДС нет в конструкторе - сумма строк 1-14 уже включает НДС
    // ИТОГО = сумма строк 1-14 (НДС уже внутри)
    grandTotal = grandTotalBeforeVAT;
    // Вычисляем НДС справочно: ИТОГО / (1 + vatCoeff/100) * (vatCoeff/100)
    vatCost = grandTotal / (1 + vatCoeff / 100) * (vatCoeff / 100);
  }

  console.log('=== Financial Indicators Calculation (ФОРМУЛЫ) ===');
  console.log('--- ПРЯМЫЕ ЗАТРАТЫ ---');
  console.log('  Direct costs (base):', directCostsTotal.toLocaleString('ru-RU'));
  console.log('    - Subcontract:', subcontractTotal.toLocaleString('ru-RU'));
  console.log('    - SU-10:', su10Total.toLocaleString('ru-RU'));
  console.log('    - Reserve (comp):', reserveForDeliveryTotal.toLocaleString('ru-RU'));
  console.log('--- НАЦЕНКИ (формульный расчёт) ---');
  console.log('  Mechanization:', mechanizationCost.toLocaleString('ru-RU'), `(${mechanizationCoeff}%)`);
  console.log('  MVP+GSM:', mvpGsmCost.toLocaleString('ru-RU'), `(${mvpGsmCoeff}%)`);
  console.log('  Warranty:', warrantyCost.toLocaleString('ru-RU'), `(${warrantyCoeff}%)`);
  console.log('  0.6k coefficient:', coefficient06Cost.toLocaleString('ru-RU'), `(${coefficient06}%)`);
  console.log('  Cost growth total:', totalCostGrowth.toLocaleString('ru-RU'));
  console.log('    - works growth:', worksCostGrowthAmount.toLocaleString('ru-RU'), `(${worksCostGrowth}%)`);
  console.log('    - materials growth:', materialCostGrowthAmount.toLocaleString('ru-RU'), `(${materialCostGrowth}%)`);
  console.log('    - subcontract works growth:', subcontractWorksCostGrowthAmount.toLocaleString('ru-RU'), `(${subcontractWorksCostGrowth}%)`);
  console.log('    - subcontract materials growth:', subcontractMaterialsCostGrowthAmount.toLocaleString('ru-RU'), `(${subcontractMaterialsCostGrowth}%)`);
  console.log('  Unforeseeable:', unforeseeableCost.toLocaleString('ru-RU'), `(${unforeseeableCoeff}%)`);
  console.log('  Overhead own forces (ООЗ):', overheadOwnForcesCost.toLocaleString('ru-RU'), `(${overheadOwnForcesCoeff}%)`);
  console.log('  Overhead subcontract (ООЗ суб):', overheadSubcontractCost.toLocaleString('ru-RU'), `(${overheadSubcontractCoeff}%)`);
  console.log('  General costs (ОФЗ):', generalCostsCost.toLocaleString('ru-RU'), `(${generalCostsCoeff}%)`);
  console.log('  Profit own forces:', profitOwnForcesCost.toLocaleString('ru-RU'), `(${profitOwnForcesCoeff}%)`);
  console.log('  Profit subcontract:', profitSubcontractCost.toLocaleString('ru-RU'), `(${profitSubcontractCoeff}%)`);
  console.log('--- НДС ---');
  console.log('  VAT in constructor:', isVatInConstructor);
  console.log('  VAT coefficient:', vatCoeff);
  console.log('  Sum before VAT (rows 1-14):', grandTotalBeforeVAT.toLocaleString('ru-RU'));
  console.log('  VAT cost:', vatCost.toLocaleString('ru-RU'));
  console.log('--- ИТОГО ---');
  console.log('  GRAND TOTAL (по формулам FI):', grandTotal.toLocaleString('ru-RU'));

  console.log('');
  console.log('======= СРАВНЕНИЕ COMMERCE vs FINANCIAL INDICATORS =======');
  const commercialGrandTotal = totalCommercialMaterial + totalCommercialWork;
  console.log('  COMMERCE (boq_items total_commercial_*):', commercialGrandTotal.toLocaleString('ru-RU'));
  console.log('  FINANCIAL INDICATORS (формулы):', grandTotal.toLocaleString('ru-RU'));
  console.log('  РАЗНИЦА:', (commercialGrandTotal - grandTotal).toLocaleString('ru-RU'));
  console.log('  РАЗНИЦА %:', ((commercialGrandTotal - grandTotal) / grandTotal * 100).toFixed(4) + '%');
  console.log('=============================================================');

  return {
    subcontractTotal,
    su10Total,
    reserveForDeliveryTotal,
    directCostsTotal,
    directCostsRowTotal,
    worksSu10Only,
    mechanizationCost,
    coefficient06Cost,
    mvpGsmCost,
    warrantyCost,
    worksWithMarkup,
    worksCostGrowthAmount,
    materialCostGrowthAmount,
    subcontractWorksCostGrowthAmount,
    subcontractMaterialsCostGrowthAmount,
    totalCostGrowth,
    baseForUnforeseeable,
    unforeseeableCost,
    baseForOOZ,
    overheadOwnForcesCost,
    subcontractGrowth,
    baseForSubcontractOOZ,
    overheadSubcontractCost,
    baseForOFZ,
    generalCostsCost,
    baseForProfit,
    profitOwnForcesCost,
    baseForSubcontractProfit,
    profitSubcontractCost,
    insuranceCost,
    grandTotalBeforeVAT,
    vatCost,
    grandTotal,
  };
};
