/**
 * Отладка расчета и сохранения коммерческих стоимостей
 */

import { supabase } from '../lib/supabase';
import { calculateMarkupResult } from './markupCalculator';
import type { CalculationContext } from './markupCalculator';

export async function debugCommercialCalculation(tenderId: string) {
  console.log('=== ОТЛАДКА РАСЧЕТА КОММЕРЧЕСКИХ СТОИМОСТЕЙ ===');
  console.log(`Тендер ID: ${tenderId}`);

  try {
    // 1. Проверяем тендер и его тактику
    console.log('\n1. ПРОВЕРКА ТЕНДЕРА И ТАКТИКИ:');
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('*, markup_tactics(*)')
      .eq('id', tenderId)
      .single();

    if (tenderError || !tender) {
      console.error('❌ Ошибка загрузки тендера:', tenderError);
      return;
    }

    console.log(`✓ Тендер: ${tender.tender_number}`);
    console.log(`  markup_tactic_id: ${tender.markup_tactic_id || 'НЕТ'}`);

    if (!tender.markup_tactic_id) {
      console.error('❌ У тендера НЕТ тактики наценок!');
      console.log('Решение: создайте тактику через кнопку "Тест" или в конструкторе тактик');
      return;
    }

    if (!tender.markup_tactics) {
      console.error('❌ Тактика не загружена!');
      return;
    }

    const tactic = tender.markup_tactics;
    console.log(`✓ Тактика: ${tactic.name || 'Без названия'}`);
    console.log(`  Sequences:`, Object.keys(tactic.sequences));

    // 2. Загружаем параметры наценок
    console.log('\n2. ЗАГРУЗКА ПАРАМЕТРОВ НАЦЕНОК:');
    const { data: markupParams, error: paramsError } = await supabase
      .from('tender_markup_percentage')
      .select('*, markup_parameter:markup_parameters(*)')
      .eq('tender_id', tenderId);

    const parametersMap = new Map<string, number>();

    if (paramsError) {
      console.error('❌ Ошибка загрузки параметров:', paramsError);
    } else if (!markupParams || markupParams.length === 0) {
      console.log('⚠️ Нет параметров наценок (используются числовые значения из тактики)');
    } else {
      console.log(`✓ Загружено параметров: ${markupParams.length}`);
      markupParams.forEach(p => {
        const param = p.markup_parameter as { key?: string } | null;
        if (param?.key) {
          parametersMap.set(param.key, p.value);
          console.log(`  ${param.key}: ${p.value}%`);
        }
      });
    }

    // 3. Получаем первый элемент BOQ для тестирования
    console.log('\n3. ТЕСТОВЫЙ РАСЧЕТ НА ПЕРВОМ ЭЛЕМЕНТЕ:');
    const { data: boqItems, error: boqError } = await supabase
      .from('boq_items')
      .select('*')
      .eq('tender_id', tenderId)
      .limit(5);

    if (boqError || !boqItems || boqItems.length === 0) {
      console.error('❌ Нет элементов BOQ для тендера!');
      return;
    }

    const testItem = boqItems[0];
    console.log(`\nТестовый элемент ID: ${testItem.id}`);
    console.log(`  Тип: ${testItem.boq_item_type}`);
    console.log(`  Базовая стоимость (total_amount): ${testItem.total_amount || 0}`);
    console.log(`  Текущая коммерч. материалы: ${testItem.total_commercial_material_cost || 0}`);
    console.log(`  Текущая коммерч. работы: ${testItem.total_commercial_work_cost || 0}`);

    if (!testItem.total_amount || testItem.total_amount === 0) {
      console.error('❌ У элемента нет базовой стоимости!');
      console.log('Решение: заполните total_amount для элементов BOQ');
      return;
    }

    // 4. Получаем последовательность для типа элемента
    console.log('\n4. ПОСЛЕДОВАТЕЛЬНОСТЬ НАЦЕНОК:');
    const sequence = tactic.sequences[testItem.boq_item_type];

    if (!sequence) {
      console.error(`❌ Нет последовательности для типа "${testItem.boq_item_type}"`);
      return;
    }

    console.log(`✓ Последовательность для "${testItem.boq_item_type}":`, JSON.stringify(sequence, null, 2));

    // 5. Выполняем расчет
    console.log('\n5. ВЫПОЛНЕНИЕ РАСЧЕТА:');
    const context: CalculationContext = {
      baseAmount: testItem.total_amount,
      itemType: testItem.boq_item_type,
      markupSequence: sequence,
      markupParameters: parametersMap,
      baseCost: tactic.base_costs?.[testItem.boq_item_type]
    };

    console.log('Контекст расчета:', {
      baseAmount: context.baseAmount,
      itemType: context.itemType,
      parametersCount: parametersMap.size,
      sequenceSteps: sequence.length
    });

    const result = calculateMarkupResult(context);

    console.log('\nРезультат расчета:');
    console.log(`  Коммерческая стоимость: ${result.commercialCost}`);
    console.log(`  Коэффициент наценки: ${result.markupCoefficient}`);
    console.log(`  Шаги расчета:`, result.stepResults);
    if (result.errors) {
      console.error('  Ошибки:', result.errors);
    }

    // 6. Сохраняем в БД
    console.log('\n6. СОХРАНЕНИЕ В БД:');
    const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(testItem.boq_item_type);

    const updateData = {
      commercial_markup: result.markupCoefficient,
      total_commercial_material_cost: isMaterial ? result.commercialCost : null,
      total_commercial_work_cost: !isMaterial ? result.commercialCost : null,
      updated_at: new Date().toISOString()
    };

    console.log('Данные для обновления:', updateData);
    console.log(`Обновляем поле: ${isMaterial ? 'total_commercial_material_cost' : 'total_commercial_work_cost'}`);

    const { data: updatedItem, error: updateError } = await supabase
      .from('boq_items')
      .update(updateData)
      .eq('id', testItem.id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ ОШИБКА ОБНОВЛЕНИЯ:', updateError);
      console.error('Детали ошибки:', JSON.stringify(updateError, null, 2));
      return;
    }

    console.log('✓ УСПЕШНО ОБНОВЛЕНО!');
    console.log('Обновленный элемент:', {
      id: updatedItem.id,
      commercial_markup: updatedItem.commercial_markup,
      total_commercial_material_cost: updatedItem.total_commercial_material_cost,
      total_commercial_work_cost: updatedItem.total_commercial_work_cost
    });

    // 7. Проверяем, что сохранилось
    console.log('\n7. ПРОВЕРКА СОХРАНЕНИЯ:');
    const { data: checkItem, error: checkError } = await supabase
      .from('boq_items')
      .select('id, commercial_markup, total_commercial_material_cost, total_commercial_work_cost')
      .eq('id', testItem.id)
      .single();

    if (checkError) {
      console.error('❌ Ошибка проверки:', checkError);
    } else {
      console.log('Проверка из БД:', checkItem);
      const savedCommercial = (checkItem.total_commercial_material_cost || 0) +
                              (checkItem.total_commercial_work_cost || 0);
      if (savedCommercial > 0) {
        console.log('✓✓✓ КОММЕРЧЕСКАЯ СТОИМОСТЬ УСПЕШНО СОХРАНЕНА В БД!');
      } else {
        console.error('❌ Коммерческая стоимость НЕ сохранена (осталась 0)');
      }
    }

    // 8. Применяем ко всем элементам
    console.log('\n8. МАССОВОЕ ПРИМЕНЕНИЕ:');
    console.log(`Всего элементов для обработки: ${boqItems.length}`);

    let successCount = 0;
    let errorCount = 0;

    for (const item of boqItems) {
      if (!item.total_amount || item.total_amount === 0) {
        console.log(`  Пропуск ${item.id}: нет базовой стоимости`);
        continue;
      }

      const itemSequence = tactic.sequences[item.boq_item_type];
      if (!itemSequence) {
        console.log(`  Пропуск ${item.id}: нет последовательности для типа ${item.boq_item_type}`);
        continue;
      }

      const itemContext: CalculationContext = {
        baseAmount: item.total_amount,
        itemType: item.boq_item_type,
        markupSequence: itemSequence,
        markupParameters: parametersMap,
        baseCost: tactic.base_costs?.[item.boq_item_type]
      };

      const itemResult = calculateMarkupResult(itemContext);
      const isItemMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type);

      const itemUpdateData = {
        commercial_markup: itemResult.markupCoefficient,
        total_commercial_material_cost: isItemMaterial ? itemResult.commercialCost : null,
        total_commercial_work_cost: !isItemMaterial ? itemResult.commercialCost : null,
        updated_at: new Date().toISOString()
      };

      const { error: itemUpdateError } = await supabase
        .from('boq_items')
        .update(itemUpdateData)
        .eq('id', item.id);

      if (itemUpdateError) {
        console.error(`  ❌ Ошибка ${item.id}:`, itemUpdateError.message);
        errorCount++;
      } else {
        console.log(`  ✓ ${item.id}: ${item.total_amount} -> ${itemResult.commercialCost}`);
        successCount++;
      }
    }

    console.log(`\n✓ Успешно обновлено: ${successCount}`);
    console.log(`❌ Ошибок: ${errorCount}`);

    console.log('\n=== КОНЕЦ ОТЛАДКИ ===');

  } catch (error) {
    console.error('КРИТИЧЕСКАЯ ОШИБКА:', error);
  }
}

// Экспортируем в window для вызова из консоли
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).debugCommercialCalculation = debugCommercialCalculation;
  console.log('Для отладки расчета выполните в консоли:');
  console.log('window.debugCommercialCalculation("ID_ТЕНДЕРА")');
}