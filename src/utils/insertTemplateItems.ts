import { supabase } from '../lib/supabase';
import type { BoqItem } from '../lib/supabase';
import { insertBoqItemWithAudit, updateBoqItemWithAudit } from '../lib/supabaseWithAudit';

interface InsertTemplateResult {
  worksCount: number;
  materialsCount: number;
  totalInserted: number;
}

/**
 * Insert all items from a template into a client position (BOQ)
 * Preserves parent_work_item_id relationships using array indices
 */
export async function insertTemplateItems(
  templateId: string,
  clientPositionId: string,
  userId?: string
): Promise<InsertTemplateResult> {
  // Validate template exists and get its default detail_cost_category_id
  const { data: template, error: templateError } = await supabase
    .from('templates')
    .select('id, name, detail_cost_category_id')
    .eq('id', templateId)
    .single();

  if (templateError || !template) {
    throw new Error('Шаблон не найден');
  }

  // Step 1: Get all template items in order
  const { data: templateItems, error: fetchError } = await supabase
    .from('template_items')
    .select(`
      *,
      work_library:work_library_id(
        id,
        work_name_id,
        unit_rate,
        currency_type,
        item_type,
        work_names(name, unit)
      ),
      material_library:material_library_id(
        id,
        material_name_id,
        unit_rate,
        currency_type,
        item_type,
        material_type,
        delivery_price_type,
        delivery_amount,
        consumption_coefficient,
        material_names(name, unit)
      )
    `)
    .eq('template_id', templateId)
    .order('position', { ascending: true });

  if (fetchError) {
    throw new Error(`Ошибка загрузки элементов шаблона: ${fetchError.message}`);
  }

  if (!templateItems || templateItems.length === 0) {
    throw new Error('Шаблон пуст');
  }

  // Get client position details for tender_id and currency rates
  const { data: position, error: posError } = await supabase
    .from('client_positions')
    .select('id, tender_id, manual_volume')
    .eq('id', clientPositionId)
    .single();

  if (posError || !position) {
    throw new Error('Позиция заказчика не найдена');
  }

  // Get tender for currency rates
  const { data: tender, error: tenderError } = await supabase
    .from('tenders')
    .select('usd_rate, eur_rate, cny_rate')
    .eq('id', position.tender_id)
    .single();

  if (tenderError) {
    throw new Error('Ошибка получения курсов валют');
  }

  // Get current max sort_number for position
  const { data: maxSortData } = await supabase
    .from('boq_items')
    .select('sort_number')
    .eq('client_position_id', clientPositionId)
    .order('sort_number', { ascending: false })
    .limit(1);

  const maxSort = maxSortData && maxSortData.length > 0 ? maxSortData[0].sort_number : 0;

  // Helper function to get currency rate
  const getCurrencyRate = (currencyType: string): number => {
    switch (currencyType) {
      case 'USD':
        return tender.usd_rate || 1;
      case 'EUR':
        return tender.eur_rate || 1;
      case 'CNY':
        return tender.cny_rate || 1;
      default:
        return 1;
    }
  };

  // Step 2: Insert all items with temporary null parent_work_item_id
  const boqItemsToInsert = templateItems.map((ti, index) => {
    const isWork = ti.kind === 'work';
    const library = isWork ? ti.work_library : ti.material_library;

    if (!library) {
      throw new Error(`Элемент шаблона #${index + 1} не имеет ссылки на библиотеку`);
    }

    const unitCode = isWork
      ? library.work_names?.unit
      : library.material_names?.unit;

    const unitRate = library.unit_rate || 0;

    const currencyType = library.currency_type || 'RUB';
    const currencyRate = getCurrencyRate(currencyType);

    // Calculate quantity
    let quantity = 1;
    if (!isWork && ti.conversation_coeff) {
      // Material with conversion coefficient
      quantity = ti.conversation_coeff * (position.manual_volume || 1);
    }

    // Calculate total amount with delivery for materials
    let deliveryPrice = 0;
    if (!isWork) {
      const deliveryPriceType = library.delivery_price_type;
      const deliveryAmount = library.delivery_amount || 0;

      if (deliveryPriceType === 'не в цене') {
        deliveryPrice = unitRate * currencyRate * 0.03;
      } else if (deliveryPriceType === 'суммой' && deliveryAmount) {
        deliveryPrice = deliveryAmount;
      }
    }

    const totalAmount = quantity * (unitRate * currencyRate + deliveryPrice);

    return {
      tender_id: position.tender_id,
      client_position_id: clientPositionId,
      sort_number: maxSort + index + 1,
      boq_item_type: library.item_type,
      material_type: !isWork ? library.material_type : null,
      work_name_id: isWork ? library.work_name_id : null,
      material_name_id: !isWork ? library.material_name_id : null,
      unit_code: unitCode,
      quantity: quantity,
      base_quantity: !isWork ? 1 : null,
      consumption_coefficient: !isWork ? (library.consumption_coefficient || 1) : null,
      conversion_coefficient: !isWork && ti.conversation_coeff ? ti.conversation_coeff : null,
      parent_work_item_id: null, // Temporarily null, will update in step 3
      currency_type: currencyType,
      unit_rate: unitRate,
      total_amount: totalAmount,
      detail_cost_category_id: ti.detail_cost_category_id || template.detail_cost_category_id,
      description: ti.note,
      delivery_price_type: !isWork ? library.delivery_price_type : null,
      delivery_amount: !isWork ? (library.delivery_amount || 0) : 0,
    };
  });

  const newBoqItems: BoqItem[] = [];

  for (const boqItem of boqItemsToInsert) {
    const { data } = await insertBoqItemWithAudit(userId, boqItem);

    if (!data?.id) {
      throw new Error('Insert RPC did not return a BOQ item ID');
    }

    newBoqItems.push(data);
  }

  // Step 3: Restore parent_work_item_id relationships using array indices
  const updates: Array<{ id: string; parent_work_item_id: string }> = [];

  templateItems.forEach((templateItem, i) => {
    if (templateItem.parent_work_item_id) {
      // Find the index of the parent work in template items array
      const parentIndex = templateItems.findIndex(
        (ti) => ti.id === templateItem.parent_work_item_id
      );

      if (parentIndex !== -1) {
        // Use the same index to get the new parent work ID
        updates.push({
          id: newBoqItems[i].id,
          parent_work_item_id: newBoqItems[parentIndex].id,
        });
      }
    }
  });

  // Batch update parent_work_item_id
  if (updates.length > 0) {
    for (const update of updates) {
      try {
        await updateBoqItemWithAudit(userId, update.id, {
          parent_work_item_id: update.parent_work_item_id,
        });
      } catch (updateError) {
        console.error('Error updating parent_work_item_id:', updateError);
        // Continue with other updates even if one fails
      }
    }
  }

  // Step 4: Recalculate position totals
  const { data: totals, error: totalsError } = await supabase
    .from('boq_items')
    .select('boq_item_type, total_amount')
    .eq('client_position_id', clientPositionId);

  if (!totalsError && totals) {
    const totalMaterial = totals
      .filter((item) =>
        ['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)
      )
      .reduce((sum, item) => sum + (item.total_amount || 0), 0);

    const totalWorks = totals
      .filter((item) => ['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type))
      .reduce((sum, item) => sum + (item.total_amount || 0), 0);

    // Update client position totals
    await supabase
      .from('client_positions')
      .update({
        total_material: totalMaterial,
        total_works: totalWorks,
      })
      .eq('id', clientPositionId);
  }

  // Calculate counts for return
  const worksCount = templateItems.filter((item) => item.kind === 'work').length;
  const materialsCount = templateItems.filter((item) => item.kind === 'material').length;

  return {
    worksCount,
    materialsCount,
    totalInserted: newBoqItems.length,
  };
}
