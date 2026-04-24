import { supabase } from '../lib/supabase';
import type { BoqItem } from '../lib/supabase';

interface CalculateGrandTotalParams {
  tenderId: string;
}

export const calculateGrandTotal = async ({ tenderId }: CalculateGrandTotalParams): Promise<number> => {
  try {
    // Загружаем тендер
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('*')
      .eq('id', tenderId)
      .single();

    if (tenderError || !tender) return 0;

    // Загружаем проценты наценок
    const { data: tenderMarkupPercentages } = await supabase
      .from('tender_markup_percentage')
      .select(`
        *,
        markup_parameter:markup_parameters(*)
      `)
      .eq('tender_id', tenderId);

    // Загружаем ВСЕ BOQ элементы с батчингом
    let boqItems: BoqItem[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('boq_items')
        .select(`
          *,
          client_position:client_positions!inner(tender_id)
        `)
        .eq('client_position.tender_id', tenderId)
        .range(from, from + batchSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        boqItems = [...boqItems, ...(data as unknown as BoqItem[])];
        from += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    // Загрузка исключений роста субподряда
    const { data: exclusions } = await supabase
      .from('subcontract_growth_exclusions')
      .select('detail_cost_category_id')
      .eq('tender_id', tenderId);

    const excludedCategoryIds = new Set(
      exclusions?.map(e => e.detail_cost_category_id) || []
    );

    // Расчет прямых затрат
    let subcontractWorks = 0;
    let subcontractMaterials = 0;
    let subcontractWorksForGrowth = 0;
    let subcontractMaterialsForGrowth = 0;
    let works = 0;
    let materials = 0;
    let materialsComp = 0;
    let worksComp = 0;

    boqItems?.forEach(item => {
      const baseCost = item.total_amount || 0;
      const categoryId = item.detail_cost_category_id;
      const isExcludedFromGrowth = categoryId && excludedCategoryIds.has(categoryId);

      switch (item.boq_item_type) {
        case 'суб-раб':
          subcontractWorks += baseCost;
          if (!isExcludedFromGrowth) {
            subcontractWorksForGrowth += baseCost;
          }
          break;
        case 'суб-мат':
          subcontractMaterials += baseCost;
          if (!isExcludedFromGrowth) {
            subcontractMaterialsForGrowth += baseCost;
          }
          break;
        case 'раб':
          works += baseCost;
          break;
        case 'мат':
          materials += baseCost;
          break;
        case 'мат-комп.':
          materialsComp += baseCost;
          break;
        case 'раб-комп.':
          worksComp += baseCost;
          break;
      }
    });

    const subcontractTotal = subcontractWorks + subcontractMaterials;
    const su10Total = works + materials + materialsComp + worksComp;
    const directCostsTotal = subcontractTotal + su10Total;

    const markupParams = (tenderMarkupPercentages || [])
      .map(tmp => tmp.markup_parameter)
      .filter(Boolean);

    const percentagesMap = new Map<string, number>();
    tenderMarkupPercentages?.forEach(tmp => {
      percentagesMap.set(tmp.markup_parameter_id, tmp.value);
    });

    // Получение параметров наценок
    const mechanizationParam = markupParams.find(p =>
      p.label.toLowerCase().includes('механизац') ||
      p.label.toLowerCase().includes('буринц')
    );

    const mvpGsmParam = markupParams.find(p =>
      p.label.toLowerCase().includes('мвп') ||
      p.label.toLowerCase().includes('гсм')
    );

    const warrantyParam = markupParams.find(p =>
      p.label.toLowerCase().includes('гарант')
    );

    const coefficient06Param = markupParams.find(p => {
      const name = p.label.toLowerCase();
      const key = p.key.toLowerCase();
      return name.includes('0,6') ||
             name.includes('0.6') ||
             name.includes('1,6') ||
             name.includes('1.6') ||
             (name.includes('раб') && name.includes('1')) ||
             key.includes('works_16') ||
             key.includes('works_markup');
    });

    const worksCostGrowthParam = markupParams.find(p =>
      p.label.toLowerCase().includes('рост') &&
      p.label.toLowerCase().includes('работ') &&
      !p.label.toLowerCase().includes('субподряд')
    );

    const materialCostGrowthParam = markupParams.find(p =>
      p.label.toLowerCase().includes('рост') &&
      p.label.toLowerCase().includes('материал') &&
      !p.label.toLowerCase().includes('субподряд')
    );

    const subcontractWorksCostGrowthParam = markupParams.find(p =>
      p.label.toLowerCase().includes('рост') &&
      p.label.toLowerCase().includes('работ') &&
      p.label.toLowerCase().includes('субподряд')
    );

    const subcontractMaterialsCostGrowthParam = markupParams.find(p =>
      p.label.toLowerCase().includes('рост') &&
      p.label.toLowerCase().includes('материал') &&
      p.label.toLowerCase().includes('субподряд')
    );

    const overheadOwnForcesParam = markupParams.find(p =>
      p.label.toLowerCase().includes('ооз') &&
      !p.label.toLowerCase().includes('субподряд')
    );

    const overheadSubcontractParam = markupParams.find(p =>
      p.label.toLowerCase().includes('ооз') &&
      p.label.toLowerCase().includes('субподряд')
    );

    const generalCostsParam = markupParams.find(p =>
      p.label.toLowerCase().includes('офз') ||
      (p.label.toLowerCase().includes('общ') && p.label.toLowerCase().includes('затрат'))
    );

    const profitOwnForcesParam = markupParams.find(p =>
      p.label.toLowerCase().includes('прибыль') &&
      !p.label.toLowerCase().includes('субподряд')
    );

    const profitSubcontractParam = markupParams.find(p =>
      p.label.toLowerCase().includes('прибыль') &&
      p.label.toLowerCase().includes('субподряд')
    );

    const unforeseeableParam = markupParams.find(p =>
      p.label.toLowerCase().includes('непредвид') ||
      p.label.toLowerCase().includes('непредвиден')
    );

    // Получение коэффициентов
    const mechanizationCoeff = mechanizationParam
      ? (percentagesMap.get(mechanizationParam.id) ?? mechanizationParam.default_value)
      : 0;

    const mvpGsmCoeff = mvpGsmParam
      ? (percentagesMap.get(mvpGsmParam.id) ?? mvpGsmParam.default_value)
      : 0;

    const warrantyCoeff = warrantyParam
      ? (percentagesMap.get(warrantyParam.id) ?? warrantyParam.default_value)
      : 0;

    const coefficient06 = coefficient06Param
      ? (percentagesMap.get(coefficient06Param.id) ?? coefficient06Param.default_value)
      : 0;

    const worksCostGrowth = worksCostGrowthParam
      ? (percentagesMap.get(worksCostGrowthParam.id) ?? worksCostGrowthParam.default_value)
      : 0;

    const materialCostGrowth = materialCostGrowthParam
      ? (percentagesMap.get(materialCostGrowthParam.id) ?? materialCostGrowthParam.default_value)
      : 0;

    const subcontractWorksCostGrowth = subcontractWorksCostGrowthParam
      ? (percentagesMap.get(subcontractWorksCostGrowthParam.id) ?? subcontractWorksCostGrowthParam.default_value)
      : 0;

    const subcontractMaterialsCostGrowth = subcontractMaterialsCostGrowthParam
      ? (percentagesMap.get(subcontractMaterialsCostGrowthParam.id) ?? subcontractMaterialsCostGrowthParam.default_value)
      : 0;

    const overheadOwnForcesCoeff = overheadOwnForcesParam
      ? (percentagesMap.get(overheadOwnForcesParam.id) ?? overheadOwnForcesParam.default_value)
      : 0;

    const overheadSubcontractCoeff = overheadSubcontractParam
      ? (percentagesMap.get(overheadSubcontractParam.id) ?? overheadSubcontractParam.default_value)
      : 0;

    const generalCostsCoeff = generalCostsParam
      ? (percentagesMap.get(generalCostsParam.id) ?? generalCostsParam.default_value)
      : 0;

    const profitOwnForcesCoeff = profitOwnForcesParam
      ? (percentagesMap.get(profitOwnForcesParam.id) ?? profitOwnForcesParam.default_value)
      : 0;

    const profitSubcontractCoeff = profitSubcontractParam
      ? (percentagesMap.get(profitSubcontractParam.id) ?? profitSubcontractParam.default_value)
      : 0;

    const unforeseeableCoeff = unforeseeableParam
      ? (percentagesMap.get(unforeseeableParam.id) ?? unforeseeableParam.default_value)
      : 0;

    // Расчет затрат
    const worksSu10Only = works;
    const mechanizationCost = worksSu10Only * (mechanizationCoeff / 100);
    const coefficient06Cost = (worksSu10Only + mechanizationCost) * (coefficient06 / 100);
    const mvpGsmCost = worksSu10Only * (mvpGsmCoeff / 100);
    const warrantyCost = worksSu10Only * (warrantyCoeff / 100);

    const worksWithMarkup = worksSu10Only + coefficient06Cost + mvpGsmCost + mechanizationCost;
    const worksCostGrowthAmount = worksWithMarkup * (worksCostGrowth / 100);
    const materialCostGrowthAmount = materials * (materialCostGrowth / 100);
    const subcontractWorksCostGrowthAmount = subcontractWorksForGrowth * (subcontractWorksCostGrowth / 100);
    const subcontractMaterialsCostGrowthAmount = subcontractMaterialsForGrowth * (subcontractMaterialsCostGrowth / 100);

    const totalCostGrowth = worksCostGrowthAmount +
                            materialCostGrowthAmount +
                            subcontractWorksCostGrowthAmount +
                            subcontractMaterialsCostGrowthAmount;

    const baseForUnforeseeable = worksSu10Only + coefficient06Cost + materials + mvpGsmCost + mechanizationCost;
    const unforeseeableCost = baseForUnforeseeable * (unforeseeableCoeff / 100);

    const baseForOOZ = baseForUnforeseeable + worksCostGrowthAmount + materialCostGrowthAmount + unforeseeableCost;
    const overheadOwnForcesCost = baseForOOZ * (overheadOwnForcesCoeff / 100);

    const subcontractGrowth = subcontractWorksCostGrowthAmount + subcontractMaterialsCostGrowthAmount;
    const baseForSubcontractOOZ = subcontractTotal + subcontractGrowth;
    const overheadSubcontractCost = baseForSubcontractOOZ * (overheadSubcontractCoeff / 100);

    const baseForOFZ = baseForOOZ + overheadOwnForcesCost;
    const generalCostsCost = baseForOFZ * (generalCostsCoeff / 100);

    const baseForProfit = baseForOFZ + generalCostsCost;
    const profitOwnForcesCost = baseForProfit * (profitOwnForcesCoeff / 100);

    const baseForSubcontractProfit = baseForSubcontractOOZ + overheadSubcontractCost;
    const profitSubcontractCost = baseForSubcontractProfit * (profitSubcontractCoeff / 100);

    const grandTotal = directCostsTotal +
                      mechanizationCost +
                      mvpGsmCost +
                      warrantyCost +
                      coefficient06Cost +
                      totalCostGrowth +
                      unforeseeableCost +
                      overheadOwnForcesCost +
                      overheadSubcontractCost +
                      generalCostsCost +
                      profitOwnForcesCost +
                      profitSubcontractCost;

    return grandTotal;
  } catch (error) {
    console.error('Ошибка расчета grandTotal для тендера', tenderId, error);
    return 0;
  }
};
