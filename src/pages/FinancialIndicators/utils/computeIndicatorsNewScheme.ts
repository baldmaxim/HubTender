// UI display / Excel-export only. Авторитетный расчёт — backend/internal/calc.
import type {
  DirectCostTotals,
  FinancialCalcResult,
  INewSchemeCoefficients,
  INewSchemeVariant,
  NewSchemeRowKey,
} from '../types';

/**
 * «Новая схема» (тактика с новым списком базовых процентов): строки считаются ровно по цепочке
 * тактики на базе BOQ, шаг НДС остаётся в цепочке — его приращение идёт в отдельную строку «НДС».
 * Прямые затраты и все строки — БЕЗ домножения на (1 + НДС); страхование — как пришло.
 * ИТОГО = Σ коммерческих стоимостей BOQ + страхование.
 *
 * Расчёт ЛИНЕЕН и ОДНОРОДЕН по полям `totals` и по `insuranceCost` (никаких округлений,
 * min/max, ступеней; исключённая база = subcontractWorks − subcontractWorksForGrowth может
 * быть отрицательной на единичных векторах — это нормально). На этом держится
 * discount/utils/markupMultipliers.ts.
 */
export const computeIndicatorsNewScheme = (
  totals: DirectCostTotals,
  ns: INewSchemeCoefficients,
  insuranceCost: number,
): FinancialCalcResult => {
  const rows: Record<NewSchemeRowKey, number> = {
    growthSubWorks: 0,
    growthSubMaterials: 0,
    overheadSub: 0,
    generalCosts: 0,
    vat: 0,
    profit: 0,
    other: 0,
  };

  // Приращения варианта цепочки накапливаются в замыкании; прямые затраты — без наценок.
  const applyVariant = (base: number, v: INewSchemeVariant): number => {
    (Object.keys(rows) as NewSchemeRowKey[]).forEach((key) => {
      rows[key] += base * v.increments[key];
    });
    return base;
  };

  const subWorksNormal = totals.subcontractWorksForGrowth;
  const subWorksExcluded = totals.subcontractWorks - totals.subcontractWorksForGrowth;
  const subMatNormal = totals.subcontractMaterialsForGrowth;
  const subMatExcluded = totals.subcontractMaterials - totals.subcontractMaterialsForGrowth;

  const subcontractTotal =
    applyVariant(subWorksNormal, ns.subWork) +
    applyVariant(subWorksExcluded, ns.subWorkExcluded) +
    applyVariant(subMatNormal, ns.subMaterial) +
    applyVariant(subMatExcluded, ns.subMaterialExcluded);
  const su10Total = applyVariant(totals.works, ns.work) + applyVariant(totals.materials, ns.material);
  const reserveForDeliveryTotal =
    applyVariant(totals.worksComp, ns.workComp) + applyVariant(totals.materialsComp, ns.materialComp);

  const directCostsTotal = subcontractTotal + su10Total + reserveForDeliveryTotal;

  // Страхование — отдельная строка той суммой, что пришла, без НДС.
  const insurance = insuranceCost;

  const totalCostGrowth = rows.growthSubWorks + rows.growthSubMaterials;
  const grandTotal =
    directCostsTotal +
    totalCostGrowth +
    rows.overheadSub +
    rows.generalCosts +
    rows.vat +
    rows.profit +
    rows.other +
    insurance;

  // «В том числе НДС» (строка 18 графиков) — сумма приращений шагов НДС цепочек.
  const vatCost = rows.vat;
  const grandTotalBeforeVAT = grandTotal - vatCost;

  return {
    subcontractTotal,
    su10Total,
    reserveForDeliveryTotal,
    directCostsTotal,
    directCostsRowTotal: directCostsTotal,
    worksSu10Only: totals.works,
    mechanizationCost: 0,
    coefficient06Cost: 0,
    mvpGsmCost: 0,
    warrantyCost: 0,
    worksWithMarkup: 0,
    worksCostGrowthAmount: 0,
    materialCostGrowthAmount: 0,
    subcontractWorksCostGrowthAmount: rows.growthSubWorks,
    subcontractMaterialsCostGrowthAmount: rows.growthSubMaterials,
    totalCostGrowth,
    baseForUnforeseeable: 0,
    unforeseeableCost: rows.other,
    baseForOOZ: 0,
    overheadOwnForcesCost: 0,
    subcontractGrowth: totalCostGrowth,
    baseForSubcontractOOZ: 0,
    overheadSubcontractCost: rows.overheadSub,
    baseForOFZ: 0,
    generalCostsCost: rows.generalCosts,
    baseForProfit: 0,
    profitOwnForcesCost: 0,
    baseForSubcontractProfit: 0,
    profitSubcontractCost: rows.profit,
    insuranceCost: insurance,
    grandTotalBeforeVAT,
    vatCost,
    grandTotal,
  };
};
