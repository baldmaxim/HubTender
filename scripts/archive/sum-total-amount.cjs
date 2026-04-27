const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sumTotalAmount() {
  try {
    // Найти тендер
    const { data: tender, error: tenderError } = await supabase
      .from('tenders')
      .select('id, title, version')
      .eq('title', 'ЖК События 6.2')
      .eq('version', 1)
      .single();

    if (tenderError) {
      console.error('Ошибка поиска тендера:', tenderError);
      return;
    }

    if (!tender) {
      console.log('Тендер не найден');
      return;
    }

    console.log(`Найден тендер: ${tender.title} Версия ${tender.version}`);
    console.log(`ID: ${tender.id}\n`);

    // Загрузить все boq_items батчами
    let allItems = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('boq_items')
        .select('id, total_amount, boq_item_type')
        .eq('tender_id', tender.id)
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Ошибка загрузки boq_items:', error);
        return;
      }

      if (data && data.length > 0) {
        allItems = [...allItems, ...data];
        from += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`Загружено ${allItems.length} элементов boq_items\n`);

    // Посчитать сумму
    let sum = 0;
    let countWithAmount = 0;
    let countNull = 0;

    allItems.forEach(item => {
      if (item.total_amount !== null && item.total_amount !== undefined) {
        sum += item.total_amount;
        countWithAmount++;
      } else {
        countNull++;
      }
    });

    console.log(`Элементов с total_amount: ${countWithAmount}`);
    console.log(`Элементов с NULL total_amount: ${countNull}`);
    console.log(`\n=== ИТОГО total_amount: ${sum} ===`);
    console.log(`=== Округленная: ${Math.round(sum).toLocaleString('ru-RU')} ===`);

    // Проверить логику как в UI (useClientPositions.ts)
    // Там загружаются все client_positions, потом их ID, потом boq_items по этим ID
    console.log('\n=== Эмуляция логики UI ===');

    // Загрузить client_positions для тендера
    let allPositions = [];
    let posFrom = 0;
    let posHasMore = true;

    while (posHasMore) {
      const { data: posData, error: posError } = await supabase
        .from('client_positions')
        .select('id')
        .eq('tender_id', tender.id)
        .range(posFrom, posFrom + 999);

      if (posError) {
        console.error('Ошибка загрузки позиций:', posError);
        break;
      }

      if (posData && posData.length > 0) {
        allPositions = [...allPositions, ...posData];
        posFrom += 1000;
        posHasMore = posData.length === 1000;
      } else {
        posHasMore = false;
      }
    }

    console.log(`Загружено ${allPositions.length} позиций`);

    // Получить ID позиций
    const positionIds = allPositions.map(p => p.id);

    // Загрузить boq_items батчами по 100 ID (как в UI)
    const boqBatchSize = 100;
    const batches = [];
    for (let i = 0; i < positionIds.length; i += boqBatchSize) {
      batches.push(positionIds.slice(i, i + boqBatchSize));
    }

    console.log(`Разбито на ${batches.length} батчей по ${boqBatchSize} ID`);

    let allBoqData = [];
    for (const batch of batches) {
      const { data: boqData, error: boqError } = await supabase
        .from('boq_items')
        .select('id, client_position_id, boq_item_type, total_amount')
        .in('client_position_id', batch);

      if (boqError) {
        console.error('Ошибка загрузки boq_items батча:', boqError);
        continue;
      }
      allBoqData = [...allBoqData, ...(boqData || [])];
    }

    console.log(`Загружено ${allBoqData.length} boq_items через client_position_id`);

    // Посчитать сумму как в UI
    let uiSum = 0;
    allBoqData.forEach((item) => {
      const itemTotal = item.total_amount || 0;
      uiSum += itemTotal;
    });

    console.log(`\n=== ИТОГО (логика UI): ${uiSum} ===`);
    console.log(`=== Округленная (UI): ${Math.round(uiSum).toLocaleString('ru-RU')} ===`);

    console.log(`\n=== РАЗНИЦА: ${Math.abs(sum - uiSum).toLocaleString('ru-RU')} ===`);

    if (sum !== uiSum) {
      console.log('\n⚠️ СУММЫ НЕ СОВПАДАЮТ!');
      console.log(`Прямой запрос boq_items: ${allItems.length} элементов`);
      console.log(`Через client_positions: ${allBoqData.length} элементов`);
      console.log(`Разница элементов: ${Math.abs(allItems.length - allBoqData.length)}`);
    }

    // Найти пропавшие элементы (сравнивать по ID самих boq_items)
    const loadedBoqIds = new Set(allBoqData.map(item => item.id));
    const missingItems = allItems.filter(item => !loadedBoqIds.has(item.id));

    if (missingItems.length > 0) {
      console.log(`\n⚠️ НАЙДЕНО ${missingItems.length} boq_items которые не загрузились через client_position_id`);

      // Посчитать сумму пропавших
      const missingSum = missingItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
      console.log(`Сумма пропавших элементов: ${Math.round(missingSum).toLocaleString('ru-RU')}`);

      console.log('\nПример пропавших элементов (первые 5):');
      missingItems.slice(0, 5).forEach(item => {
        console.log(`  - ID: ${item.id}, client_position_id: ${item.client_position_id}, type: ${item.boq_item_type}, total_amount: ${item.total_amount}`);
      });

      // Проверить существуют ли эти client_position_id в таблице client_positions
      const missingPositionIds = [...new Set(missingItems.map(i => i.client_position_id).filter(id => id))];
      console.log(`\nПроверяю ${missingPositionIds.length} уникальных client_position_id...`);

      if (missingPositionIds.length > 0) {
        const { data: checkPositions, error: checkError } = await supabase
          .from('client_positions')
          .select('id')
          .in('id', missingPositionIds.slice(0, 10)); // Проверить первые 10

        if (checkError) {
          console.error('Ошибка проверки позиций:', checkError);
        } else {
          console.log(`Из первых ${Math.min(10, missingPositionIds.length)} ID найдено в client_positions: ${checkPositions?.length || 0}`);
          if (checkPositions && checkPositions.length < Math.min(10, missingPositionIds.length)) {
            console.log('⚠️ Некоторые client_position_id НЕ СУЩЕСТВУЮТ в таблице client_positions!');
          } else {
            console.log('✅ Все проверенные client_position_id существуют - проблема в батчинге!');
          }
        }
      }
    } else {
      console.log('\n✅ Все элементы загружены корректно');
    }

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

sumTotalAmount();
