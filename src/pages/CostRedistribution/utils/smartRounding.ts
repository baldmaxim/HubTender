/**
 * Умное округление цен за единицу до 5 рублей с компенсацией ошибки
 */

import type { ResultRow } from '../components/Results/ResultsTableColumns';

/**
 * Округляет число до ближайшего кратного 5
 */
export function roundTo5(value: number): number {
  if (value < 2.5) return 0;
  return Math.round(value / 5) * 5;
}

interface RoundingItem {
  index: number;
  originalPrice: number;
  roundedPrice: number;
  error: number;
  fractionalPart: number;
  quantity: number;
}

/**
 * Компенсирует ошибку округления, корректируя цены с наибольшими дробными частями
 */
function compensateError(
  items: RoundingItem[],
  totalError: number
): Map<number, number> {
  const adjustments = new Map<number, number>();

  if (Math.abs(totalError) < 1) {
    return adjustments;
  }

  // Сортируем по убыванию дробной части
  const sortedItems = [...items].sort((a, b) => b.fractionalPart - a.fractionalPart);

  let remainingError = totalError;
  // Если ошибка > 0 (округление завысило итог), нужно УМЕНЬШИТЬ цены (-1)
  // Если ошибка < 0 (округление занизило итог), нужно УВЕЛИЧИТЬ цены (+1)
  const errorSign = totalError > 0 ? -1 : 1;
  const adjustmentStep = 5; // Шаг компенсации (кратно 5)

  for (const item of sortedItems) {
    if (Math.abs(remainingError) < adjustmentStep) {
      break;
    }

    // Вычисляем сколько нужно скорректировать цену
    const maxAdjustment = Math.floor(Math.abs(remainingError) / (item.quantity * adjustmentStep)) * adjustmentStep;

    if (maxAdjustment >= adjustmentStep) {
      const adjustment = maxAdjustment * errorSign;
      adjustments.set(item.index, item.roundedPrice + adjustment);
      remainingError += adjustment * item.quantity;
    }
  }

  return adjustments;
}

/**
 * Применяет умное округление к результатам перераспределения
 */
export function smartRoundResults(results: ResultRow[]): ResultRow[] {
  const materialItems: RoundingItem[] = [];
  const workItems: RoundingItem[] = [];

  // Собираем данные для округления
  results.forEach((row, index) => {
    // Материалы
    if (row.total_materials > 0 && row.quantity > 0) {
      const originalPrice = row.material_unit_price;
      const roundedPrice = roundTo5(originalPrice);
      const fractionalPart = originalPrice - Math.floor(originalPrice);
      const error = (roundedPrice - originalPrice) * row.quantity;

      materialItems.push({
        index,
        originalPrice,
        roundedPrice,
        error,
        fractionalPart,
        quantity: row.quantity,
      });
    }

    // Работы
    if (row.total_works_after > 0 && row.quantity > 0) {
      const originalPrice = row.work_unit_price_after;
      const roundedPrice = roundTo5(originalPrice);
      const fractionalPart = originalPrice - Math.floor(originalPrice);
      const error = (roundedPrice - originalPrice) * row.quantity;

      workItems.push({
        index,
        originalPrice,
        roundedPrice,
        error,
        fractionalPart,
        quantity: row.quantity,
      });
    }
  });

  // Вычисляем общую ошибку
  const totalMaterialError = materialItems.reduce((sum, item) => sum + item.error, 0);
  const totalWorkError = workItems.reduce((sum, item) => sum + item.error, 0);

  // Компенсируем ошибку
  const materialAdjustments = compensateError(materialItems, totalMaterialError);
  const workAdjustments = compensateError(workItems, totalWorkError);

  // Применяем округление и компенсацию
  const roundedResults = results.map((row, index) => {
    const result = { ...row };

    // Округляем материалы
    if (row.total_materials > 0 && row.quantity > 0) {
      const roundedPrice = materialAdjustments.get(index) ?? roundTo5(row.material_unit_price);
      result.rounded_material_unit_price = roundedPrice;
      result.rounded_total_materials = roundedPrice * row.quantity;
    } else {
      result.rounded_material_unit_price = 0;
      result.rounded_total_materials = 0;
    }

    // Округляем работы
    if (row.total_works_after > 0 && row.quantity > 0) {
      const roundedPrice = workAdjustments.get(index) ?? roundTo5(row.work_unit_price_after);
      result.rounded_work_unit_price_after = roundedPrice;
      result.rounded_total_works = roundedPrice * row.quantity;
    } else {
      result.rounded_work_unit_price_after = 0;
      result.rounded_total_works = 0;
    }

    return result;
  });

  return roundedResults;
}

