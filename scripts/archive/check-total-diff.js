const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDiff() {
  // Получаем первый тендер
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title')
    .limit(5);
  
  console.log('Тендеры:', tenders?.map(t => `${t.title} (${t.id})`));
  
  if (!tenders || tenders.length === 0) return;
  
  const tenderId = tenders[0].id;
  console.log('\n--- Проверяем тендер:', tenders[0].title, '---\n');

  // Загружаем ВСЕ boq_items для тендера
  let allItems = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('id, client_position_id, total_amount')
      .eq('tender_id', tenderId)
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Ошибка:', error);
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

  console.log('Всего boq_items:', allItems.length);

  // Сумма напрямую из boq_items
  const directSum = allItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
  console.log('Прямая сумма total_amount:', directSum.toLocaleString('ru-RU'));

  // Загружаем позиции заказчика
  let allPositions = [];
  from = 0;
  hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('client_positions')
      .select('id')
      .eq('tender_id', tenderId)
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Ошибка:', error);
      return;
    }

    if (data && data.length > 0) {
      allPositions = [...allPositions, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  console.log('Всего позиций:', allPositions.length);

  // Группируем items по позициям
  const positionIds = new Set(allPositions.map(p => p.id));
  const itemsByPosition = new Map();
  
  for (const item of allItems) {
    if (!itemsByPosition.has(item.client_position_id)) {
      itemsByPosition.set(item.client_position_id, []);
    }
    itemsByPosition.get(item.client_position_id).push(item);
  }

  // Проверяем есть ли items без позиций
  const orphanItems = allItems.filter(item => !positionIds.has(item.client_position_id));
  console.log('\nItems без позиций (orphans):', orphanItems.length);
  
  if (orphanItems.length > 0) {
    const orphanSum = orphanItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
    console.log('Сумма orphan items:', orphanSum.toLocaleString('ru-RU'));
    
    // Уникальные client_position_id orphan items
    const orphanPositionIds = [...new Set(orphanItems.map(i => i.client_position_id))];
    console.log('Уникальные orphan position IDs:', orphanPositionIds.length);
    console.log('Примеры orphan position IDs:', orphanPositionIds.slice(0, 5));
  }

  // Сумма через группировку по позициям (как в коммерции)
  let sumByPositions = 0;
  for (const posId of positionIds) {
    const items = itemsByPosition.get(posId) || [];
    for (const item of items) {
      sumByPositions += item.total_amount || 0;
    }
  }
  console.log('\nСумма через позиции:', sumByPositions.toLocaleString('ru-RU'));

  console.log('\n--- Разница ---');
  console.log('Прямая сумма - Сумма через позиции =', (directSum - sumByPositions).toLocaleString('ru-RU'));
}

checkDiff();
