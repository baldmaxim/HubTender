/**
 * Проверка структуры БД и прав доступа для коммерческих стоимостей
 */

import { supabase } from '../lib/supabase';

export async function checkDatabaseStructure() {
  console.log('=== ПРОВЕРКА СТРУКТУРЫ БД ===\n');

  try {
    // 1. Проверяем структуру таблицы boq_items
    console.log('1. Проверка таблицы boq_items:');

    // Пробуем вставить тестовую запись
    const testData = {
      tender_id: '00000000-0000-0000-0000-000000000000', // фиктивный ID
      client_position_id: '00000000-0000-0000-0000-000000000000',
      boq_item_type: 'мат' as const,
      sort_number: 999999,
      total_amount: 1000,
      commercial_markup: 1.2,
      total_commercial_material_cost: 1200,
      total_commercial_work_cost: null,
    };

    console.log('Пробуем создать тестовую запись...');
    const { data: insertTest, error: insertError } = await supabase
      .from('boq_items')
      .insert(testData)
      .select();

    if (insertError) {
      if (insertError.message.includes('violates foreign key')) {
        console.log('✓ Структура таблицы корректна (ошибка FK ожидаема для тестовых ID)');
      } else if (insertError.message.includes('column')) {
        console.error('❌ ПРОБЛЕМА СО СТРУКТУРОЙ ТАБЛИЦЫ:');
        console.error(insertError.message);

        // Проверяем какие поля отсутствуют
        if (insertError.message.includes('total_commercial_material_cost')) {
          console.error('  ⚠️ Отсутствует колонка total_commercial_material_cost');
        }
        if (insertError.message.includes('total_commercial_work_cost')) {
          console.error('  ⚠️ Отсутствует колонка total_commercial_work_cost');
        }
        if (insertError.message.includes('commercial_markup')) {
          console.error('  ⚠️ Отсутствует колонка commercial_markup');
        }

        console.log('\nРешение: выполните миграцию для добавления отсутствующих колонок');
        return;
      } else {
        console.error('Другая ошибка:', insertError);
      }
    } else {
      console.log('✓ Тестовая запись создана, удаляем...');
      // Удаляем тестовую запись
      if (insertTest && insertTest[0]) {
        await supabase
          .from('boq_items')
          .delete()
          .eq('id', insertTest[0].id);
      }
    }

    // 2. Проверяем существующие записи
    console.log('\n2. Проверка существующих записей:');
    const { data: sampleItems, error: selectError } = await supabase
      .from('boq_items')
      .select('id, boq_item_type, total_amount, commercial_markup, total_commercial_material_cost, total_commercial_work_cost')
      .limit(5);

    if (selectError) {
      console.error('❌ Ошибка чтения:', selectError.message);

      // Анализируем ошибку
      if (selectError.message.includes('column')) {
        console.error('\nПроблема: отсутствуют необходимые колонки в таблице');
        console.log('Необходимые колонки:');
        console.log('  - commercial_markup (numeric)');
        console.log('  - total_commercial_material_cost (numeric)');
        console.log('  - total_commercial_work_cost (numeric)');
      }
    } else {
      console.log(`✓ Найдено записей: ${sampleItems?.length || 0}`);

      if (sampleItems && sampleItems.length > 0) {
        console.log('\nПример структуры:');
        const sample = sampleItems[0];
        console.log('  Поля элемента:', Object.keys(sample).join(', '));

        // Проверяем наличие значений
        let hasCommercial = false;
        sampleItems.forEach(item => {
          if (item.total_commercial_material_cost || item.total_commercial_work_cost) {
            hasCommercial = true;
          }
        });

        if (hasCommercial) {
          console.log('✓ Найдены коммерческие стоимости в существующих записях');
        } else {
          console.log('⚠️ Коммерческие стоимости пусты (нужен пересчет)');
        }
      }
    }

    // 3. Проверяем права на обновление
    console.log('\n3. Проверка прав на обновление:');
    const { data: firstItem } = await supabase
      .from('boq_items')
      .select('id')
      .limit(1)
      .single();

    if (firstItem) {
      const { error: updateError } = await supabase
        .from('boq_items')
        .update({
          commercial_markup: 1.0,
          updated_at: new Date().toISOString()
        })
        .eq('id', firstItem.id);

      if (updateError) {
        console.error('❌ Нет прав на обновление:', updateError.message);
      } else {
        console.log('✓ Права на обновление есть');
      }
    }

    // 4. Проверяем RLS политики
    console.log('\n4. Проверка RLS (Row Level Security):');
    const { data: rls, error: rlsError } = await supabase.rpc('check_rls_status', {
      table_name: 'boq_items'
    }).single();

    if (rlsError) {
      console.log('  Не удалось проверить RLS (функция может отсутствовать)');
    } else if (rls) {
      console.log(`  RLS статус: ${(rls as Record<string, unknown>)['enabled'] ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
      if ((rls as Record<string, unknown>)['enabled']) {
        console.log('  ⚠️ RLS включен - убедитесь, что есть политики для обновления');
      }
    }

    console.log('\n=== КОНЕЦ ПРОВЕРКИ ===');

  } catch (error) {
    console.error('Критическая ошибка:', error);
  }
}

// Экспортируем в window для вызова из консоли
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).checkDatabaseStructure = checkDatabaseStructure;
  console.log('Для проверки структуры БД выполните в консоли:');
  console.log('window.checkDatabaseStructure()');
}