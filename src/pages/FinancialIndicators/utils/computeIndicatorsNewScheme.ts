// UI display / Excel-export only. Авторитетный расчёт — backend/internal/calc.
import type {
  DirectCostTotals,
  FinancialCalcResult,
  INewSchemeCoefficients,
  INewSchemeVariant,
  NewSchemeRowKey,
} from '../types';

/**
 * «Новая схема» (тактика с новым списком базовых процентов): итог строки BOQ =
 * база × коэффициент цепочки × (1 + НДС%), как у движка. Суммы строк уже с НДС.
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
    profit: 0,
    other: 0,
  };
  let vatTotal = 0;

  // Прямые затраты варианта с НДС; строки и НДС накапливаются в замыкании.
  const applyVariant = (base: number, v: INewSchemeVariant): number => {
    const f = 1 + v.vatPct / 100;
    (Object.keys(rows) as NewSchemeRowKey[]).forEach((key) => {
      rows[key] += base * v.increments[key] * f;
    });
    vatTotal += (base * v.coeff * v.vatPct) / 100;
    return base * f;
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

  // Страхование: НДС добавляется сверху, только если он есть в тактике.
  const vatMain = ns.vatMainPct / 100;
  const insurance = ns.anyVat ? insuranceCost * (1 + vatMain) : insuranceCost;
  if (ns.anyVat) vatTotal += insuranceCost * vatMain;

  const totalCostGrowth = rows.growthSubWorks + rows.growthSubMaterials;
  const grandTotal =
    directCostsTotal +
    totalCostGrowth +
    rows.overheadSub +
    rows.generalCosts +
    rows.profit +
    rows.other +
    insurance;

  // НДС в тактике нет — справочно выделяем из ИТОГО, как в старой схеме.
  const vatCost = ns.anyVat ? vatTotal : (grandTotal / (1 + vatMain)) * vatMain;
  const grandTotalBeforeVAT = ns.anyVat ? grandTotal - vatCost : grandTotal;

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
