// Подписи и тултипы строк «Финансовых показателей» для новой схемы (расчёт по тактике).
// Накладываются поверх строк buildIndicatorRows: числа уже посчитаны, меняем только тексты.
import type { FinancialCalcResult, IndicatorRow, MarkupCoefficients } from '../types';

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const pct = (v: number) => `${parseFloat(v.toFixed(5))}%`;

const BY_TACTIC = 'Расчёт по тактике наценок (новый список процентов): цепочка каждого типа затрат применяется к базе строки BOQ';

export const applyNewSchemeLabels = (
  rows: IndicatorRow[],
  calc: FinancialCalcResult,
  coeffs: MarkupCoefficients,
): IndicatorRow[] => {
  const vatPct = coeffs.vatCoeff;
  const patch: Record<number, Partial<IndicatorRow>> = {
    1: {
      tooltip: `Состав прямых затрат${coeffs.isVatInConstructor ? ' (с НДС)' : ''}:\n` +
        `1. Субподряд: ${fmt(calc.subcontractTotal)}\n` +
        `2. Работы + Материалы СУ-10: ${fmt(calc.su10Total)}\n` +
        `3. Запас на сдачу объекта: ${fmt(calc.reserveForDeliveryTotal)}\n` +
        `= ${fmt(calc.directCostsRowTotal)} руб.`,
    },
    9: {
      tooltip: `${BY_TACTIC}.\n` +
        `Рост работ субподряда: ${fmt(calc.subcontractWorksCostGrowthAmount)} руб.\n` +
        `Рост материалов субподряда: ${fmt(calc.subcontractMaterialsCostGrowthAmount)} руб.\n` +
        `Итого: ${fmt(calc.totalCostGrowth)} руб.`,
    },
    10: {
      indicator_name: 'Прочие наценки',
      coefficient: '',
      tooltip: `${BY_TACTIC}.\nЧасть наценок цепочек, не относящаяся к росту, ООЗ, ОФЗ и прибыли: ${fmt(calc.unforeseeableCost)} руб.`,
    },
    12: {
      indicator_name: 'ООЗ Субподряда',
      tooltip: `${BY_TACTIC}.\nООЗ Субподряда (${pct(coeffs.overheadSubcontractCoeff)}): ${fmt(calc.overheadSubcontractCost)} руб.`,
    },
    13: {
      indicator_name: 'ОФЗ',
      tooltip: `${BY_TACTIC}.\nОФЗ (${pct(coeffs.generalCostsCoeff)}): ${fmt(calc.generalCostsCost)} руб.`,
    },
    15: {
      indicator_name: 'Прибыль (скидка)',
      tooltip: `${BY_TACTIC}.\nПрибыль (скидка) (${pct(coeffs.profitSubcontractCoeff)}): ${fmt(calc.profitSubcontractCost)} руб.`,
    },
    18: {
      indicator_name: vatPct > 0 ? `В том числе НДС ${pct(vatPct)}` : 'В том числе НДС',
      coefficient: vatPct > 0 ? pct(vatPct) : '',
      tooltip: coeffs.isVatInConstructor
        ? `НДС цепочек тактики (суммы строк уже с НДС), плюс НДС ${pct(vatPct)} на страхование.\n` +
          `Сумма без НДС: ${fmt(calc.grandTotalBeforeVAT)}\nНДС: ${fmt(calc.vatCost)} руб.`
        : `НДС в тактике нет: ИТОГО / (1 + ${pct(vatPct)}) × ${pct(vatPct)}\n` +
          `ИТОГО: ${fmt(calc.grandTotal)}\nНДС: ${fmt(calc.vatCost)} руб.`,
    },
  };
  return rows.map((row) => (patch[row.row_number] ? { ...row, ...patch[row.row_number] } : row));
};
