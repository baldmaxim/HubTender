/**
 * Два списка базовых процентов наценок (markup_parameters.percent_set):
 * старый ('old') и новый ('new', ключи с префиксом new_).
 * Наборы ключей роста субподряда и НДС — зеркало Go (backend/internal/calc/boq_item_cost.go).
 */

import type { MarkupParameter, MarkupSequences, MarkupStep } from '../../lib/types';

export type PercentSet = 'old' | 'new';

export const PERCENT_SET_LABELS: Record<PercentSet, string> = {
  old: 'Старые базовые проценты',
  new: 'Новые базовые проценты',
};

/** Ключи параметров нового списка. */
export const NEW_PERCENT_KEYS = {
  subWorksGrowth: 'new_subcontract_works_cost_growth',
  subMaterialsGrowth: 'new_subcontract_materials_cost_growth',
  overheadSubcontract: 'new_overhead_subcontract',
  generalCosts: 'new_general_costs',
  vat: 'new_nds',
  profitDiscount: 'new_profit_discount',
} as const;

/** Рост стоимости работ субподряда (суб-раб): старый и новый списки. */
export const SUBCONTRACT_WORKS_GROWTH_KEYS: readonly string[] = [
  'subcontract_works_cost_growth',
  NEW_PERCENT_KEYS.subWorksGrowth,
];

/** Рост стоимости материалов субподряда (суб-мат): старый и новый списки. */
export const SUBCONTRACT_MATERIALS_GROWTH_KEYS: readonly string[] = [
  'subcontract_materials_cost_growth',
  NEW_PERCENT_KEYS.subMaterialsGrowth,
];

/** НДС: старый и новый списки. */
export const VAT_PARAM_KEYS: readonly string[] = ['nds_22', NEW_PERCENT_KEYS.vat];

/** Ключи параметров наценок (operandNType === 'markup'), на которые ссылается тактика, по всем типам. */
export const collectTacticMarkupKeys = (
  sequences: MarkupSequences | null | undefined,
): Set<string> => {
  const keys = new Set<string>();
  if (!sequences) return keys;

  Object.values(sequences).forEach((steps: MarkupStep[] | undefined) => {
    if (!Array.isArray(steps)) return;
    steps.forEach((step) => {
      const operands: Array<[MarkupStep['operand1Type'] | undefined, string | number | undefined]> = [
        [step.operand1Type, step.operand1Key],
        [step.operand2Type, step.operand2Key],
        [step.operand3Type, step.operand3Key],
        [step.operand4Type, step.operand4Key],
        [step.operand5Type, step.operand5Key],
      ];
      operands.forEach(([type, key]) => {
        if (type === 'markup' && key) keys.add(String(key));
      });
    });
  });
  return keys;
};

/** 'new', если тактика ссылается хотя бы на один параметр нового списка, иначе 'old'. */
export const inferTacticPercentSet = (
  sequences: MarkupSequences | null | undefined,
  params: MarkupParameter[],
): PercentSet => {
  const keys = collectTacticMarkupKeys(sequences);
  if (keys.size === 0) return 'old';
  return params.some((p) => p.percent_set === 'new' && keys.has(p.key)) ? 'new' : 'old';
};

/** Параметры указанного списка в порядке order_num. */
export const filterParamsBySet = (
  params: MarkupParameter[],
  set: PercentSet,
): MarkupParameter[] =>
  params
    // Без percent_set (старый бэкенд) параметр считается старым списком.
    .filter((p) => (p.percent_set ?? 'old') === set)
    .sort((a, b) => (a.order_num ?? 0) - (b.order_num ?? 0));
