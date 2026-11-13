// Коэффициенты «новой схемы» финансовых показателей: расчёт ПО ТАКТИКЕ наценок
// (тендеры, чья тактика ссылается на новый список базовых процентов).
// Повторяет шаги движка по строке BOQ (services/markupTactic/calculation.ts):
// цепочка типа → исключения роста (суб-раб/суб-мат) → отделение НДС → цепочка на базе 1.
import type { MarkupSequences, MarkupStep } from '../../../lib/types';
import {
  filterSequenceForExclusions,
  filterVATFromSequence,
} from '../../../services/markupTactic/calculation';
import { NEW_PERCENT_KEYS } from '../../../services/markupTactic/percentSets';
import { calculateMarkupResult } from '../../../utils/markupCalculator';
import type {
  DirectCostTotals,
  INewSchemeCoefficients,
  INewSchemeVariant,
  MarkupCoefficients,
  NewSchemeRowKey,
} from '../types';

/** Ключ параметра нового списка → строка, в которую попадает приращение шага. */
const ROW_BY_PARAM_KEY: Record<string, NewSchemeRowKey> = {
  [NEW_PERCENT_KEYS.subWorksGrowth]: 'growthSubWorks',
  [NEW_PERCENT_KEYS.subMaterialsGrowth]: 'growthSubMaterials',
  [NEW_PERCENT_KEYS.overheadSubcontract]: 'overheadSub',
  [NEW_PERCENT_KEYS.generalCosts]: 'generalCosts',
  [NEW_PERCENT_KEYS.profitDiscount]: 'profit',
};

const emptyIncrements = (): Record<NewSchemeRowKey, number> => ({
  growthSubWorks: 0,
  growthSubMaterials: 0,
  overheadSub: 0,
  generalCosts: 0,
  profit: 0,
  other: 0,
});

const IDENTITY_VARIANT = (vatPct: number): INewSchemeVariant => ({
  coeff: 1,
  vatPct,
  increments: emptyIncrements(),
});

/** Строка шага по его единственному markup-ключу; иначе 'other'. */
const rowKeyOfStep = (step: MarkupStep): NewSchemeRowKey => {
  const operands: Array<[MarkupStep['operand1Type'] | undefined, string | number | undefined]> = [
    [step.operand1Type, step.operand1Key],
    [step.operand2Type, step.operand2Key],
    [step.operand3Type, step.operand3Key],
    [step.operand4Type, step.operand4Key],
    [step.operand5Type, step.operand5Key],
  ];
  const keys = new Set<string>();
  operands.forEach(([type, key]) => {
    if (type === 'markup' && key !== undefined && key !== '') keys.add(String(key));
  });
  if (keys.size !== 1) return 'other';
  return ROW_BY_PARAM_KEY[[...keys][0]] ?? 'other';
};

/** Вариант цепочки: коэффициент на базе 1, НДС и разложение приращений по строкам. */
const buildVariant = (
  sequence: MarkupStep[] | undefined,
  excludedType: 'суб-раб' | 'суб-мат' | null,
  paramValues: Map<string, number>,
): INewSchemeVariant => {
  // Пустая цепочка типа — движок строки не пересчитывает: ×1, без наценки.
  if (!sequence || sequence.length === 0) return IDENTITY_VARIANT(0);

  const afterExclusions = excludedType
    ? filterSequenceForExclusions(sequence, true, excludedType)
    : sequence;
  const { filtered, vatCoefficient } = filterVATFromSequence(afterExclusions, paramValues);
  if (filtered.length === 0) return IDENTITY_VARIANT(vatCoefficient);

  const { commercialCost: coeff, stepResults } = calculateMarkupResult({
    baseAmount: 1,
    itemType: 'мат',
    markupSequence: filtered,
    markupParameters: paramValues,
  });

  // Идём от последнего шага по цепочке baseIndex; защита от циклов — база строго раньше шага.
  const increments = emptyIncrements();
  let index = filtered.length - 1;
  while (index >= 0 && index < stepResults.length) {
    const baseIndex = filtered[index].baseIndex;
    const baseValue = baseIndex === -1 ? 1 : stepResults[baseIndex];
    if (baseIndex !== -1 && (baseIndex < 0 || baseIndex >= index || baseValue === undefined)) break;
    increments[rowKeyOfStep(filtered[index])] += stepResults[index] - baseValue;
    if (baseIndex === -1) break;
    index = baseIndex;
  }

  // Всё, что не разложилось по строкам, уходит в 'other': Σ приращений = coeff − 1.
  const sum = Object.values(increments).reduce((acc, v) => acc + v, 0);
  increments.other += coeff - 1 - sum;

  return { coeff, vatPct: vatCoefficient, increments };
};

/**
 * Коэффициенты всех вариантов цепочек тактики.
 * paramValues — значения параметров по ключу, ТОЛЬКО из строк процентов тендера (без default_value).
 */
export const buildNewSchemeCoefficients = (
  sequences: MarkupSequences,
  paramValues: Map<string, number>,
): INewSchemeCoefficients => {
  const work = buildVariant(sequences['раб'], null, paramValues);
  const material = buildVariant(sequences['мат'], null, paramValues);
  const subWork = buildVariant(sequences['суб-раб'], null, paramValues);
  const subWorkExcluded = buildVariant(sequences['суб-раб'], 'суб-раб', paramValues);
  const subMaterial = buildVariant(sequences['суб-мат'], null, paramValues);
  const subMaterialExcluded = buildVariant(sequences['суб-мат'], 'суб-мат', paramValues);
  const workComp = buildVariant(sequences['раб-комп.'], null, paramValues);
  const materialComp = buildVariant(sequences['мат-комп.'], null, paramValues);

  const variants = [
    work, material, subWork, subWorkExcluded, subMaterial, subMaterialExcluded, workComp, materialComp,
  ];

  return {
    work,
    material,
    subWork,
    subWorkExcluded,
    subMaterial,
    subMaterialExcluded,
    workComp,
    materialComp,
    vatMainPct: paramValues.get(NEW_PERCENT_KEYS.vat) ?? 0,
    anyVat: variants.some((v) => v.vatPct > 0),
  };
};

/** Числовые поля MarkupCoefficients для отображения процентов в новой схеме. */
export const buildNewSchemeMarkupCoefficients = (
  newScheme: INewSchemeCoefficients,
  paramValues: Map<string, number>,
): MarkupCoefficients => ({
  scheme: 'new',
  newScheme,
  mechanizationCoeff: 0,
  mvpGsmCoeff: 0,
  warrantyCoeff: 0,
  coefficient06: 0,
  worksCostGrowth: 0,
  materialCostGrowth: 0,
  subcontractWorksCostGrowth: paramValues.get(NEW_PERCENT_KEYS.subWorksGrowth) ?? 0,
  subcontractMaterialsCostGrowth: paramValues.get(NEW_PERCENT_KEYS.subMaterialsGrowth) ?? 0,
  overheadOwnForcesCoeff: 0,
  overheadSubcontractCoeff: paramValues.get(NEW_PERCENT_KEYS.overheadSubcontract) ?? 0,
  generalCostsCoeff: paramValues.get(NEW_PERCENT_KEYS.generalCosts) ?? 0,
  profitOwnForcesCoeff: 0,
  profitSubcontractCoeff: paramValues.get(NEW_PERCENT_KEYS.profitDiscount) ?? 0,
  unforeseeableCoeff: 0,
  vatCoeff: newScheme.vatMainPct,
  isVatInConstructor: newScheme.anyVat,
});

/**
 * Прямые затраты, домноженные по типам на (1 + НДС цепочки) — для отображения строк
 * «с НДС» (в новой схеме суммы строк уже содержат НДС). Множитель типа — по обычному
 * варианту цепочки (у исключённого НДС тот же: фильтр исключений НДС не затрагивает).
 */
export const scaleTotalsByVat = (
  totals: DirectCostTotals,
  ns: INewSchemeCoefficients,
): DirectCostTotals => {
  const f = (v: INewSchemeVariant) => 1 + v.vatPct / 100;
  const fSubWork = f(ns.subWork);
  const fSubMat = f(ns.subMaterial);
  const fWork = f(ns.work);
  const fMat = f(ns.material);
  return {
    ...totals,
    subcontractWorks: totals.subcontractWorks * fSubWork,
    subcontractWorksForGrowth: totals.subcontractWorksForGrowth * fSubWork,
    subcontractMaterials: totals.subcontractMaterials * fSubMat,
    subcontractMaterialsForGrowth: totals.subcontractMaterialsForGrowth * fSubMat,
    subcontractMaterialsBasic: totals.subcontractMaterialsBasic * fSubMat,
    subcontractMaterialsAux: totals.subcontractMaterialsAux * fSubMat,
    subcontractMaterialsForGrowthBasic: totals.subcontractMaterialsForGrowthBasic * fSubMat,
    subcontractMaterialsForGrowthAux: totals.subcontractMaterialsForGrowthAux * fSubMat,
    works: totals.works * fWork,
    materials: totals.materials * fMat,
    materialsBasic: totals.materialsBasic * fMat,
    materialsAux: totals.materialsAux * fMat,
    worksComp: totals.worksComp * f(ns.workComp),
    materialsComp: totals.materialsComp * f(ns.materialComp),
  };
};
