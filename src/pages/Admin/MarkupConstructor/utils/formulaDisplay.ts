import type { MarkupParameter, MarkupStep } from '../../../../lib/supabase';
import { ACTIONS } from '../constants';
import type { GetPercent } from './sequenceCalc';

export interface FormulaContext {
  baseCost: number;
  intermediateResults: number[];
  markupParameters: MarkupParameter[];
  getPercent: GetPercent;
}

const fmt = (value: number) =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Читаемая формула шага («База × Наценка (12%) …»).
 * Перенесено из renderMarkupSequenceTab без изменений логики.
 */
export const buildStepFormula = (
  step: MarkupStep,
  { baseCost, intermediateResults, markupParameters, getPercent }: FormulaContext,
): string => {
  // Определяем базовую стоимость
  let baseName: string;
  if (step.baseIndex === -1) {
    baseName = 'Базовая';
  } else {
    baseName = `Пункт ${step.baseIndex + 1}`;
  }

  // Получаем первый операнд
  let op1Name: string;
  let op1ValueNum: number;
  if (step.operand1Type === 'markup' && step.operand1Key) {
    const markup = markupParameters.find(m => m.key === step.operand1Key);
    op1Name = markup?.label || String(step.operand1Key);
    op1ValueNum = getPercent(step.operand1Key) || 0;
  } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
    if (step.operand1Index === -1) {
      op1Name = 'Базовая стоимость';
      op1ValueNum = baseCost;
    } else {
      op1Name = `Пункт ${step.operand1Index + 1}`;
      op1ValueNum = intermediateResults[step.operand1Index] || 0;
    }
  } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
    op1Name = String(step.operand1Key);
    op1ValueNum = step.operand1Key;
  } else {
    op1Name = '?';
    op1ValueNum = 0;
  }

  // Формируем формулу первой операции
  const action1Obj = ACTIONS.find(a => a.value === step.action1);
  let formula = `${baseName} ${action1Obj?.symbol} ${op1Name}`;
  if (step.operand1Type === 'markup') {
    formula += ` (${op1ValueNum}%)`;
  }

  // Добавляем вторую операцию, если есть
  if (step.action2 && step.operand2Type) {
    let op2Name: string;
    let op2ValueNum: number;
    if (step.operand2Type === 'markup' && step.operand2Key) {
      const markup = markupParameters.find(m => m.key === step.operand2Key);
      op2Name = markup?.label || String(step.operand2Key);
      op2ValueNum = getPercent(step.operand2Key) || 0;
    } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
      if (step.operand2Index === -1) {
        op2Name = 'Базовая стоимость';
        op2ValueNum = baseCost;
      } else {
        op2Name = `Пункт ${step.operand2Index + 1}`;
        op2ValueNum = intermediateResults[step.operand2Index] || 0;
      }
    } else {
      op2Name = '?';
      op2ValueNum = 0;
    }

    const action2Obj = ACTIONS.find(a => a.value === step.action2);
    formula += ` ${action2Obj?.symbol} ${op2Name}`;
    if (step.operand2Type === 'markup') {
      formula += ` (${op2ValueNum}%)`;
    }
  }

  // Добавляем третью операцию, если есть
  if (step.action3 && step.operand3Type) {
    let op3Name: string;
    let op3ValueNum: number;
    if (step.operand3Type === 'markup' && step.operand3Key) {
      const markup = markupParameters.find(m => m.key === step.operand3Key);
      op3Name = markup?.label || String(step.operand3Key);
      op3ValueNum = getPercent(step.operand3Key) || 0;
    } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
      if (step.operand3Index === -1) {
        op3Name = 'Базовая стоимость';
        op3ValueNum = baseCost;
      } else {
        op3Name = `Пункт ${step.operand3Index + 1}`;
        op3ValueNum = intermediateResults[step.operand3Index] || 0;
      }
    } else {
      op3Name = '?';
      op3ValueNum = 0;
    }

    const action3Obj = ACTIONS.find(a => a.value === step.action3);
    formula += ` ${action3Obj?.symbol} ${op3Name}`;
    if (step.operand3Type === 'markup') {
      formula += ` (${op3ValueNum}%)`;
    }
  }

  // Добавляем четвертую операцию, если есть
  if (step.action4 && step.operand4Type) {
    let op4Name: string;
    let op4ValueNum: number;
    if (step.operand4Type === 'markup' && step.operand4Key) {
      const markup = markupParameters.find(m => m.key === step.operand4Key);
      op4Name = markup?.label || String(step.operand4Key);
      op4ValueNum = getPercent(step.operand4Key) || 0;
    } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
      if (step.operand4Index === -1) {
        op4Name = 'Базовая стоимость';
        op4ValueNum = baseCost;
      } else {
        op4Name = `Пункт ${step.operand4Index + 1}`;
        op4ValueNum = intermediateResults[step.operand4Index] || 0;
      }
    } else {
      op4Name = '?';
      op4ValueNum = 0;
    }

    const action4Obj = ACTIONS.find(a => a.value === step.action4);
    formula += ` ${action4Obj?.symbol} ${op4Name}`;
    if (step.operand4Type === 'markup') {
      formula += ` (${op4ValueNum}%)`;
    }
  }

  // Добавляем пятую операцию, если есть
  if (step.action5 && step.operand5Type) {
    let op5Name: string;
    let op5ValueNum: number;
    if (step.operand5Type === 'markup' && step.operand5Key) {
      const markup = markupParameters.find(m => m.key === step.operand5Key);
      op5Name = markup?.label || String(step.operand5Key);
      op5ValueNum = getPercent(step.operand5Key) || 0;
    } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
      if (step.operand5Index === -1) {
        op5Name = 'Базовая стоимость';
        op5ValueNum = baseCost;
      } else {
        op5Name = `Пункт ${step.operand5Index + 1}`;
        op5ValueNum = intermediateResults[step.operand5Index] || 0;
      }
    } else {
      op5Name = '?';
      op5ValueNum = 0;
    }

    const action5Obj = ACTIONS.find(a => a.value === step.action5);
    formula += ` ${action5Obj?.symbol} ${op5Name}`;
    if (step.operand5Type === 'markup') {
      formula += ` (${op5ValueNum}%)`;
    }
  }

  return formula;
};

/**
 * Детальная формула шага с числами («(100,00 × 1.12) × …»).
 * Перенесено из renderMarkupSequenceTab без изменений логики.
 */
export const buildDetailedFormula = (
  step: MarkupStep,
  { baseCost, intermediateResults, getPercent }: FormulaContext,
): string => {
  // Базовая стоимость шага
  const baseValue = step.baseIndex === -1
    ? baseCost
    : (intermediateResults[step.baseIndex] || baseCost);

  // Значение первого операнда (как в исходном рендере)
  let op1ValueNum: number;
  if (step.operand1Type === 'markup' && step.operand1Key) {
    op1ValueNum = getPercent(step.operand1Key) || 0;
  } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
    op1ValueNum = step.operand1Index === -1 ? baseCost : (intermediateResults[step.operand1Index] || 0);
  } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
    op1ValueNum = step.operand1Key;
  } else {
    op1ValueNum = 0;
  }

  const action1Obj = ACTIONS.find(a => a.value === step.action1);

  // Формируем детальную формулу с числами
  let detailedFormula = '';

  // Первая операция
  if (step.operand1Type === 'markup') {
    const format1 = step.operand1MultiplyFormat || 'addOne';
    if (step.action1 === 'multiply') {
      const multiplier = format1 === 'addOne' ? (1 + (op1ValueNum / 100)) : (op1ValueNum / 100);
      detailedFormula = `(${fmt(baseValue)} ${action1Obj?.symbol} ${Number(multiplier.toFixed(4))})`;
    } else {
      const multiplier = 1 + (op1ValueNum / 100);
      detailedFormula = `(${fmt(baseValue)} ${action1Obj?.symbol} ${Number(multiplier.toFixed(4))})`;
    }
  } else if (step.operand1Type === 'number') {
    detailedFormula = `(${fmt(baseValue)} ${action1Obj?.symbol} ${op1ValueNum})`;
  } else {
    detailedFormula = `(${fmt(baseValue)} ${action1Obj?.symbol} ${fmt(op1ValueNum)})`;
  }

  // Вторая операция
  if (step.action2 && step.operand2Type) {
    let op2ValueNum: number;
    if (step.operand2Type === 'markup' && step.operand2Key) {
      op2ValueNum = getPercent(step.operand2Key) || 0;
    } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
      op2ValueNum = step.operand2Index === -1 ? baseCost : (intermediateResults[step.operand2Index] || 0);
    } else {
      op2ValueNum = 0;
    }

    const action2Obj = ACTIONS.find(a => a.value === step.action2);
    if (step.operand2Type === 'markup') {
      const format2 = step.operand2MultiplyFormat || 'addOne';
      if (step.action2 === 'multiply') {
        const multiplier = format2 === 'addOne' ? (1 + (op2ValueNum / 100)) : (op2ValueNum / 100);
        detailedFormula += ` ${action2Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      } else {
        const multiplier = 1 + (op2ValueNum / 100);
        detailedFormula += ` ${action2Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      }
    } else {
      detailedFormula += ` ${action2Obj?.symbol} ${fmt(op2ValueNum)}`;
    }
  }

  // Третья операция
  if (step.action3 && step.operand3Type) {
    let op3ValueNum: number;
    if (step.operand3Type === 'markup' && step.operand3Key) {
      op3ValueNum = getPercent(step.operand3Key) || 0;
    } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
      op3ValueNum = step.operand3Index === -1 ? baseCost : (intermediateResults[step.operand3Index] || 0);
    } else {
      op3ValueNum = 0;
    }

    const action3Obj = ACTIONS.find(a => a.value === step.action3);
    if (step.operand3Type === 'markup') {
      const format3 = step.operand3MultiplyFormat || 'addOne';
      if (step.action3 === 'multiply') {
        const multiplier = format3 === 'addOne' ? (1 + (op3ValueNum / 100)) : (op3ValueNum / 100);
        detailedFormula += ` ${action3Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      } else {
        const multiplier = 1 + (op3ValueNum / 100);
        detailedFormula += ` ${action3Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      }
    } else {
      detailedFormula += ` ${action3Obj?.symbol} ${fmt(op3ValueNum)}`;
    }
  }

  // Четвертая операция
  if (step.action4 && step.operand4Type) {
    let op4ValueNum: number;
    if (step.operand4Type === 'markup' && step.operand4Key) {
      op4ValueNum = getPercent(step.operand4Key) || 0;
    } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
      op4ValueNum = step.operand4Index === -1 ? baseCost : (intermediateResults[step.operand4Index] || 0);
    } else {
      op4ValueNum = 0;
    }

    const action4Obj = ACTIONS.find(a => a.value === step.action4);
    if (step.operand4Type === 'markup') {
      const format4 = step.operand4MultiplyFormat || 'addOne';
      if (step.action4 === 'multiply') {
        const multiplier = format4 === 'addOne' ? (1 + (op4ValueNum / 100)) : (op4ValueNum / 100);
        detailedFormula += ` ${action4Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      } else {
        const multiplier = 1 + (op4ValueNum / 100);
        detailedFormula += ` ${action4Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      }
    } else {
      detailedFormula += ` ${action4Obj?.symbol} ${fmt(op4ValueNum)}`;
    }
  }

  // Пятая операция
  if (step.action5 && step.operand5Type) {
    let op5ValueNum: number;
    if (step.operand5Type === 'markup' && step.operand5Key) {
      op5ValueNum = getPercent(step.operand5Key) || 0;
    } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
      op5ValueNum = step.operand5Index === -1 ? baseCost : (intermediateResults[step.operand5Index] || 0);
    } else {
      op5ValueNum = 0;
    }

    const action5Obj = ACTIONS.find(a => a.value === step.action5);
    if (step.operand5Type === 'markup') {
      const format5 = step.operand5MultiplyFormat || 'addOne';
      if (step.action5 === 'multiply') {
        const multiplier = format5 === 'addOne' ? (1 + (op5ValueNum / 100)) : (op5ValueNum / 100);
        detailedFormula += ` ${action5Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      } else {
        const multiplier = 1 + (op5ValueNum / 100);
        detailedFormula += ` ${action5Obj?.symbol} ${Number(multiplier.toFixed(4))}`;
      }
    } else {
      detailedFormula += ` ${action5Obj?.symbol} ${fmt(op5ValueNum)}`;
    }
  }

  return detailedFormula;
};
