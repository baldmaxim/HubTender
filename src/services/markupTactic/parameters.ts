/**
 * Загрузка параметров наценок для тендеров
 */

import { listTenderMarkupPercentages } from '../../lib/api/markup';

/**
 * Загружает параметры наценок для тендера
 * @param tenderId ID тендера
 * @returns Map с параметрами наценок (ключ -> значение)
 */
export async function loadMarkupParameters(tenderId: string): Promise<Map<string, number>> {
  const parametersMap = new Map<string, number>();

  try {
    // Go BFF: GET /api/v1/tenders/{id}/markup/percentages — строки уже с
    // присоединённым markup_parameter (содержит key).
    const rows = await listTenderMarkupPercentages(tenderId);

    for (const r of rows) {
      const keyName = r.markup_parameter?.key;
      if (keyName) {
        parametersMap.set(keyName, r.value);
      }
    }

    if (parametersMap.size === 0) {
      return getFallbackParameters();
    }

    return parametersMap;

  } catch {
    return getFallbackParameters();
  }
}

/**
 * Возвращает фоллбэк параметры для случаев когда БД недоступна
 */
export function getFallbackParameters(): Map<string, number> {
  const parametersMap = new Map<string, number>();

  // Базовые параметры для расчета коэффициентов
  parametersMap.set('mechanization_service', 5);
  parametersMap.set('mbp_gsm', 5);
  parametersMap.set('warranty_period', 5);
  parametersMap.set('works_16_markup', 60);
  parametersMap.set('works_cost_growth', 10);
  parametersMap.set('material_cost_growth', 10);
  parametersMap.set('subcontract_works_cost_growth', 10);
  parametersMap.set('subcontract_materials_cost_growth', 10);
  parametersMap.set('contingency_costs', 3);
  parametersMap.set('overhead_own_forces', 10);
  parametersMap.set('overhead_subcontract', 10);
  parametersMap.set('general_costs_without_subcontract', 20);
  parametersMap.set('profit_own_forces', 10);
  parametersMap.set('profit_subcontract', 16);

  return parametersMap;
}
