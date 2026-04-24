/**
 * Загрузка параметров наценок для тендеров
 */

import { supabase } from '../../lib/supabase';

/**
 * Загружает параметры наценок для тендера
 * @param tenderId ID тендера
 * @returns Map с параметрами наценок (ключ -> значение)
 */
export async function loadMarkupParameters(tenderId: string): Promise<Map<string, number>> {
  const parametersMap = new Map<string, number>();

  try {
    // Загружаем значения из tender_markup_percentage вместе с ключами из markup_parameters
    const { data: tenderPercentages, error } = await supabase
      .from('tender_markup_percentage')
      .select(`
        markup_parameter_id,
        value,
        markup_parameter:markup_parameters(key)
      `)
      .eq('tender_id', tenderId);

    if (error) {
      return getFallbackParameters();
    }

    if (tenderPercentages && tenderPercentages.length > 0) {
      for (const param of tenderPercentages) {
        const mp = param.markup_parameter;
        const keyName = (Array.isArray(mp) ? mp[0] : mp)?.key;
        if (keyName) {
          parametersMap.set(keyName, param.value);
        }
      }
    }

    if (parametersMap.size === 0) {
      return getFallbackParameters();
    }

    return parametersMap;

  } catch (error) {
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
