/**
 * Диагностический скрипт для проверки данных коммерческих стоимостей
 */

import { supabase } from '../lib/supabase';

export async function checkCommercialData(tenderId?: string) {
  console.log('=== Диагностика коммерческих стоимостей ===');

  try {
    // 1. Проверяем тендеры
    const { data: tenders, error: tendersError } = await supabase
      .from('tenders')
      .select('id, tender_number, markup_tactic_id')
      .limit(5);

    if (tendersError) {
      console.error('Ошибка загрузки тендеров:', tendersError);
      return;
    }

    console.log('\n1. Тендеры в БД:');
    if (!tenders || tenders.length === 0) {
      console.log('   НЕТ ТЕНДЕРОВ В БД!');
      return;
    }

    for (const tender of tenders) {
      console.log(`   - ${tender.tender_number}: markup_tactic_id = ${tender.markup_tactic_id || 'НЕ ЗАДАНА'}`);
    }

    // Выбираем тендер для проверки
    const testTenderId = tenderId || tenders[0]?.id;
    if (!testTenderId) {
      console.log('Нет тендера для проверки');
      return;
    }

    console.log(`\n2. Проверяем тендер ID: ${testTenderId}`);

    // 2. Проверяем тактику наценок
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('*, markup_tactics(*)')
      .eq('id', testTenderId)
      .single();

    if (tenderError || !tender) {
      console.error('Ошибка загрузки тендера:', tenderError);
      return;
    }

    console.log(`   Тендер: ${tender.tender_number}`);
    if (!tender.markup_tactic_id) {
      console.log('   ⚠️ У тендера НЕТ привязанной тактики наценок!');
      console.log('   Решение: Нужно создать и привязать тактику наценок к тендеру');

      // Проверяем, есть ли вообще тактики
      const { data: tactics } = await supabase
        .from('markup_tactics')
        .select('id, name')
        .limit(5);

      if (tactics && tactics.length > 0) {
        console.log('\n   Доступные тактики:');
        tactics.forEach(t => console.log(`     - ${t.id}: ${t.name || 'Без названия'}`));
      } else {
        console.log('   ⚠️ В БД НЕТ тактик наценок! Нужно создать.');
      }
    } else {
      console.log(`   ✓ Тактика наценок: ${tender.markup_tactic_id}`);
      if (tender.markup_tactics) {
        console.log(`     Название: ${tender.markup_tactics.name || 'Без названия'}`);
        console.log(`     Sequences: ${JSON.stringify(Object.keys(tender.markup_tactics.sequences))}`);
      }
    }

    // 3. Проверяем параметры наценок
    console.log('\n3. Параметры наценок для тендера:');
    const { data: markupParams, error: paramsError } = await supabase
      .from('tender_markup_percentage')
      .select('*, markup_parameter:markup_parameters(*)')
      .eq('tender_id', testTenderId);

    if (paramsError) {
      console.error('   Ошибка загрузки параметров:', paramsError);
    } else if (!markupParams || markupParams.length === 0) {
      console.log('   ⚠️ НЕТ параметров наценок для тендера!');
      console.log('   Решение: Нужно задать значения параметров наценок');
    } else {
      console.log(`   Найдено параметров: ${markupParams.length}`);
      markupParams.slice(0, 5).forEach(p => {
        const param = p.markup_parameter as { label?: string; key?: string } | null;
        console.log(`     - ${param?.label || param?.key}: ${p.value}%`);
      });
    }

    // 4. Проверяем элементы BOQ
    console.log('\n4. Элементы BOQ (первые 10):');
    const { data: boqItems, error: boqError } = await supabase
      .from('boq_items')
      .select('id, boq_item_type, total_amount, commercial_markup, total_commercial_material_cost, total_commercial_work_cost')
      .eq('tender_id', testTenderId)
      .limit(10);

    if (boqError) {
      console.error('   Ошибка загрузки BOQ:', boqError);
    } else if (!boqItems || boqItems.length === 0) {
      console.log('   НЕТ элементов BOQ для тендера!');
    } else {
      console.log(`   Найдено элементов: ${boqItems.length}`);

      let hasCommercial = false;
      let hasBase = false;

      boqItems.forEach((item) => {
        const commercialCost = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
        const status = commercialCost > 0 ? '✓' : '✗';

        if (commercialCost > 0) hasCommercial = true;
        if (item.total_amount && item.total_amount > 0) hasBase = true;

        console.log(`   ${status} ${item.boq_item_type}: base=${item.total_amount || 0}, commercial=${commercialCost}, markup=${item.commercial_markup || 0}`);
      });

      console.log('\n   Итоги проверки:');
      if (!hasBase) {
        console.log('   ⚠️ Нет базовых стоимостей (total_amount) - нечего наценивать!');
      }
      if (!hasCommercial) {
        console.log('   ⚠️ Коммерческие стоимости НЕ рассчитаны!');
        console.log('   Решение: Нужно нажать кнопку "Пересчитать" на странице Коммерция');
      } else {
        console.log('   ✓ Коммерческие стоимости рассчитаны');
      }
    }

    // 5. Проверяем позиции заказчика
    console.log('\n5. Позиции заказчика:');
    const { data: positions, error: posError } = await supabase
      .from('client_positions')
      .select('id, position_number, work_name')
      .eq('tender_id', testTenderId)
      .limit(5);

    if (posError) {
      console.error('   Ошибка загрузки позиций:', posError);
    } else if (!positions || positions.length === 0) {
      console.log('   НЕТ позиций заказчика для тендера!');
    } else {
      console.log(`   Найдено позиций: ${positions.length}`);

      // Проверяем элементы первой позиции
      const firstPos = positions[0];
      const { data: posItems } = await supabase
        .from('boq_items')
        .select('id')
        .eq('client_position_id', firstPos.id);

      console.log(`   Позиция ${firstPos.position_number}: ${posItems?.length || 0} элементов`);
    }

    console.log('\n=== Конец диагностики ===\n');

  } catch (error) {
    console.error('Ошибка диагностики:', error);
  }
}

// Автоматический запуск при загрузке страницы Commerce
if (typeof window !== 'undefined' && window.location.pathname === '/commerce') {
  console.log('Запуск диагностики для страницы Commerce...');
  checkCommercialData();
}