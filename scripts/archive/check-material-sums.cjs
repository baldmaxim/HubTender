// Проверка расчёта итоговой суммы для материалов
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

// Анализ позиции и материалов
async function analyzePosition(positionId) {
  // 3. Найти материалы с проблемными суммами
  const { data: items, error: itemsError } = await supabase
    .from('boq_items')
    .select(`
      id,
      material_names (name, unit),
      quantity,
      unit_rate,
      delivery_amount,
      total_amount,
      conversion_coefficient,
      consumption_coefficient
    `)
    .eq('client_position_id', positionId)
    .or('material_name_id.not.is.null')
    .order('sort_number');

  if (itemsError) {
    console.error('Ошибка загрузки материалов:', itemsError);
    return;
  }

  console.log(`\nНайдено материалов: ${items.length}\n`);

  // 4. Проверить материалы, содержащие 'ЕАЕ KX'
  const problematicMaterials = items.filter(item => {
    const name = item.material_names?.name || '';
    return name.includes('ЕАЕ KX') && name.includes('41504');
  });

  console.log(`Найдено проблемных материалов: ${problematicMaterials.length}\n`);

  problematicMaterials.forEach((item, idx) => {
    console.log(`\n=== Материал ${idx + 1} ===`);
    console.log('ID:', item.id);
    console.log('Наименование:', item.material_names?.name);
    console.log('Ед. изм.:', item.material_names?.unit);
    console.log('\nДанные из БД:');
    console.log('  Количество (quantity):', item.quantity);
    console.log('  Цена за единицу (unit_rate):', item.unit_rate);
    console.log('  Стоимость доставки (delivery_amount):', item.delivery_amount);
    console.log('  Коэфф. перевода (conversion_coefficient):', item.conversion_coefficient);
    console.log('  Коэфф. расхода (consumption_coefficient):', item.consumption_coefficient);
    console.log('  Итоговая сумма в БД (total_amount):', item.total_amount);

    // Рассчитать правильную итоговую сумму
    const quantity = Number(item.quantity) || 0;
    const unitRate = Number(item.unit_rate) || 0;
    const deliveryAmount = Number(item.delivery_amount) || 0;
    const conversionCoeff = Number(item.conversion_coefficient) || 1;
    const consumptionCoeff = Number(item.consumption_coefficient) || 1;

    // Формула расчёта (по логике приложения)
    const calculatedSum = quantity * unitRate + deliveryAmount;

    console.log('\nРасчёт:');
    console.log(`  Простая формула: ${quantity} * ${unitRate} + ${deliveryAmount} = ${calculatedSum.toFixed(2)}`);
    console.log(`  Разница: ${(item.total_amount - calculatedSum).toFixed(2)}`);

    if (Math.abs(item.total_amount - calculatedSum) > 0.01) {
      console.log('  ⚠️  НЕСООТВЕТСТВИЕ! Итоговая сумма в БД не совпадает с расчётной');
    } else {
      console.log('  ✓ Итоговая сумма верна');
    }
  });

  // 5. Вывести все материалы позиции для анализа
  console.log('\n\n=== ВСЕ МАТЕРИАЛЫ ПОЗИЦИИ (первые 20) ===\n');
  items.slice(0, 20).forEach((item, idx) => {
    const name = item.material_names?.name || 'N/A';
    console.log(`${idx + 1}. ${name.substring(0, 60)}... - ${item.total_amount}`);
  });
}

async function checkMaterialSums() {
  try {
    console.log('Поиск тендера "ЖК События 6.2" версия 1...\n');

    // 1. Найти тендер
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('id, title, version')
      .ilike('title', '%События%')
      .eq('version', 1)
      .single();

    if (tenderError) {
      console.error('Ошибка поиска тендера:', tenderError);
      return;
    }

    console.log('Найден тендер:', tender);
    console.log('Tender ID:', tender.id);

    // 2. Найти позицию с указанным названием (сначала все позиции)
    const { data: allPositions, error: allPosError } = await supabase
      .from('client_positions')
      .select('id, work_name, position_number')
      .eq('tender_id', tender.id)
      .order('position_number');

    if (allPosError) {
      console.error('Ошибка загрузки позиций:', allPosError);
      return;
    }

    console.log(`\nВсего позиций: ${allPositions.length}`);
    console.log('Первые 10 позиций:');
    allPositions.slice(0, 10).forEach(p => {
      console.log(`  ${p.position_number}. ${p.work_name.substring(0, 80)}...`);
    });

    // Найти позицию содержащую "1014" и "силового электрооборудования"
    const position = allPositions.find(p =>
      p.work_name.includes('1014') && p.work_name.includes('силового электрооборудования')
    );

    if (!position) {
      console.error('\n⚠️  Позиция не найдена!');
      console.log('\nПопробуем найти все позиции с номером 1014...');
      const posBy1014 = allPositions.filter(p => p.position_number === 1014 || p.work_name.includes('1014'));
      if (posBy1014.length > 0) {
        console.log(`Найдено позиций: ${posBy1014.length}`);
        posBy1014.forEach(p => {
          console.log(`  ${p.position_number}. ${p.work_name}`);
        });

        // Попробуем использовать первую найденную позицию
        console.log('\nИспользуем первую найденную позицию для анализа...');
        const position = posBy1014[0];
        console.log('\nНайдена позиция:', position.work_name);
        console.log('Position ID:', position.id);

        // Продолжить с этой позицией (вынесем логику в отдельную функцию)
        await analyzePosition(position.id);
        return;
      } else {
        console.log('Позиции с номером 1014 не найдены');
        return;
      }
    }

    console.log('\nНайдена позиция:', position.work_name);
    console.log('Position ID:', position.id);

    // Анализировать позицию
    await analyzePosition(position.id);

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

checkMaterialSums();
