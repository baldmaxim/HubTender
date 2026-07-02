import type { MarkupStep } from '../../../../lib/supabase';

// Значение процента наценки по ключу параметра (в UI — form.getFieldValue).
export type GetPercent = (key: string | number) => number;

// ВАЖНО: это НЕ делегируется в src/utils/markupCalculator.ts — реализации
// не эквивалентны поведенчески (противоположные дефолты multiplyFormat).
// Перенесено из MarkupConstructor.calculateIntermediateResults verbatim,
// form.getFieldValue заменён параметром getPercent.

// Расчет промежуточных итогов
export const calculateIntermediateResults = (
  sequence: MarkupStep[],
  baseCost: number,
  getPercent: GetPercent,
): number[] => {
  const results: number[] = [];

  sequence.forEach((step) => {
    // Определяем базовую стоимость для этого шага
    let baseValue: number;
    if (step.baseIndex === -1) {
      baseValue = baseCost;
    } else {
      baseValue = results[step.baseIndex] || baseCost;
    }

    // Получаем значение первого операнда
    let operand1Value: number;
    if (step.operand1Type === 'markup' && step.operand1Key) {
      const percentValue = getPercent(step.operand1Key) || 0;
      operand1Value = percentValue / 100;
    } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
      operand1Value = step.operand1Index === -1 ? baseCost : (results[step.operand1Index] || baseCost);
    } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
      operand1Value = step.operand1Key;
    } else {
      operand1Value = 0;
    }

    // Применяем первую операцию
    let resultValue: number;
    switch (step.action1) {
      case 'multiply':
        if (step.operand1Type === 'markup') {
          // Если formат 'direct' - умножаем напрямую на процент, иначе на (1 + процент)
          const multiplyFormat = step.operand1MultiplyFormat || 'addOne';
          resultValue = multiplyFormat === 'direct'
            ? baseValue * operand1Value
            : baseValue * (1 + operand1Value);
        } else {
          resultValue = baseValue * operand1Value;
        }
        break;
      case 'divide':
        if (step.operand1Type === 'markup') {
          resultValue = baseValue / (1 + operand1Value);
        } else {
          resultValue = baseValue / operand1Value;
        }
        break;
      case 'add':
        if (step.operand1Type === 'markup') {
          resultValue = baseValue + (baseValue * operand1Value);
        } else {
          resultValue = baseValue + operand1Value;
        }
        break;
      case 'subtract':
        if (step.operand1Type === 'markup') {
          resultValue = baseValue - (baseValue * operand1Value);
        } else {
          resultValue = baseValue - operand1Value;
        }
        break;
      default:
        resultValue = baseValue;
    }

    // Применяем вторую операцию, если она есть
    if (step.action2 && step.operand2Type) {
      let operand2Value: number;
      if (step.operand2Type === 'markup' && step.operand2Key) {
        const percentValue = getPercent(step.operand2Key) || 0;
        operand2Value = percentValue / 100;
      } else if (step.operand2Type === 'step' && step.operand2Index !== undefined) {
        operand2Value = step.operand2Index === -1 ? baseCost : (results[step.operand2Index] || baseCost);
      } else if (step.operand2Type === 'number' && typeof step.operand2Key === 'number') {
        operand2Value = step.operand2Key;
      } else {
        operand2Value = 0;
      }

      switch (step.action2) {
        case 'multiply':
          if (step.operand2Type === 'markup') {
            const multiplyFormat2 = step.operand2MultiplyFormat || 'addOne';
            resultValue = multiplyFormat2 === 'direct'
              ? resultValue * operand2Value
              : resultValue * (1 + operand2Value);
          } else {
            resultValue = resultValue * operand2Value;
          }
          break;
        case 'divide':
          if (step.operand2Type === 'markup') {
            resultValue = resultValue / (1 + operand2Value);
          } else {
            resultValue = resultValue / operand2Value;
          }
          break;
        case 'add':
          if (step.operand2Type === 'markup') {
            resultValue = resultValue + (resultValue * operand2Value);
          } else {
            resultValue = resultValue + operand2Value;
          }
          break;
        case 'subtract':
          if (step.operand2Type === 'markup') {
            resultValue = resultValue - (resultValue * operand2Value);
          } else {
            resultValue = resultValue - operand2Value;
          }
          break;
      }
    }

    // Применяем третью операцию, если она есть
    if (step.action3 && step.operand3Type) {
      let operand3Value: number;
      if (step.operand3Type === 'markup' && step.operand3Key) {
        const percentValue = getPercent(step.operand3Key) || 0;
        operand3Value = percentValue / 100;
      } else if (step.operand3Type === 'step' && step.operand3Index !== undefined) {
        operand3Value = step.operand3Index === -1 ? baseCost : (results[step.operand3Index] || baseCost);
      } else if (step.operand3Type === 'number' && typeof step.operand3Key === 'number') {
        operand3Value = step.operand3Key;
      } else {
        operand3Value = 0;
      }

      switch (step.action3) {
        case 'multiply':
          if (step.operand3Type === 'markup') {
            const multiplyFormat3 = step.operand3MultiplyFormat || 'addOne';
            resultValue = multiplyFormat3 === 'direct'
              ? resultValue * operand3Value
              : resultValue * (1 + operand3Value);
          } else {
            resultValue = resultValue * operand3Value;
          }
          break;
        case 'divide':
          if (step.operand3Type === 'markup') {
            resultValue = resultValue / (1 + operand3Value);
          } else {
            resultValue = resultValue / operand3Value;
          }
          break;
        case 'add':
          if (step.operand3Type === 'markup') {
            resultValue = resultValue + (resultValue * operand3Value);
          } else {
            resultValue = resultValue + operand3Value;
          }
          break;
        case 'subtract':
          if (step.operand3Type === 'markup') {
            resultValue = resultValue - (resultValue * operand3Value);
          } else {
            resultValue = resultValue - operand3Value;
          }
          break;
      }
    }

    // Применяем четвертую операцию, если она есть
    if (step.action4 && step.operand4Type) {
      let operand4Value: number;
      if (step.operand4Type === 'markup' && step.operand4Key) {
        const percentValue = getPercent(step.operand4Key) || 0;
        operand4Value = percentValue / 100;
      } else if (step.operand4Type === 'step' && step.operand4Index !== undefined) {
        operand4Value = step.operand4Index === -1 ? baseCost : (results[step.operand4Index] || baseCost);
      } else if (step.operand4Type === 'number' && typeof step.operand4Key === 'number') {
        operand4Value = step.operand4Key;
      } else {
        operand4Value = 0;
      }

      switch (step.action4) {
        case 'multiply':
          if (step.operand4Type === 'markup') {
            const multiplyFormat4 = step.operand4MultiplyFormat || 'addOne';
            resultValue = multiplyFormat4 === 'direct'
              ? resultValue * operand4Value
              : resultValue * (1 + operand4Value);
          } else {
            resultValue = resultValue * operand4Value;
          }
          break;
        case 'divide':
          if (step.operand4Type === 'markup') {
            resultValue = resultValue / (1 + operand4Value);
          } else {
            resultValue = resultValue / operand4Value;
          }
          break;
        case 'add':
          if (step.operand4Type === 'markup') {
            resultValue = resultValue + (resultValue * operand4Value);
          } else {
            resultValue = resultValue + operand4Value;
          }
          break;
        case 'subtract':
          if (step.operand4Type === 'markup') {
            resultValue = resultValue - (resultValue * operand4Value);
          } else {
            resultValue = resultValue - operand4Value;
          }
          break;
      }
    }

    // Применяем пятую операцию, если она есть
    if (step.action5 && step.operand5Type) {
      let operand5Value: number;
      if (step.operand5Type === 'markup' && step.operand5Key) {
        const percentValue = getPercent(step.operand5Key) || 0;
        operand5Value = percentValue / 100;
      } else if (step.operand5Type === 'step' && step.operand5Index !== undefined) {
        operand5Value = step.operand5Index === -1 ? baseCost : (results[step.operand5Index] || baseCost);
      } else if (step.operand5Type === 'number' && typeof step.operand5Key === 'number') {
        operand5Value = step.operand5Key;
      } else {
        operand5Value = 0;
      }

      switch (step.action5) {
        case 'multiply':
          if (step.operand5Type === 'markup') {
            const multiplyFormat5 = step.operand5MultiplyFormat || 'addOne';
            resultValue = multiplyFormat5 === 'direct'
              ? resultValue * operand5Value
              : resultValue * (1 + operand5Value);
          } else {
            resultValue = resultValue * operand5Value;
          }
          break;
        case 'divide':
          if (step.operand5Type === 'markup') {
            resultValue = resultValue / (1 + operand5Value);
          } else {
            resultValue = resultValue / operand5Value;
          }
          break;
        case 'add':
          if (step.operand5Type === 'markup') {
            resultValue = resultValue + (resultValue * operand5Value);
          } else {
            resultValue = resultValue + operand5Value;
          }
          break;
        case 'subtract':
          if (step.operand5Type === 'markup') {
            resultValue = resultValue - (resultValue * operand5Value);
          } else {
            resultValue = resultValue - operand5Value;
          }
          break;
      }
    }

    results.push(resultValue);
  });

  return results;
};
