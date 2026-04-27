require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDiff() {
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title, version')
    .ilike('title', '%событи%')
    .order('version', { ascending: false });

  if (!tenders || tenders.length === 0) return;

  const tenderId = tenders[0].id;
  console.log('Тендер:', tenders[0].title, 'v' + tenders[0].version);

  // ======= СИМУЛЯЦИЯ СТРАНИЦЫ "ПОЗИЦИИ ЗАКАЗЧИКА" =======
  console.log('\n=== Симуляция useClientPositions ===');

  // 1. Загружаем позиции батчами
  let allPositions = [];
  let from = 0;
  const positionsBatchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tenderId)
      .order('position_number', { ascending: true })
      .range(from, from + positionsBatchSize - 1);

    if (error) { console.error('Ошибка:', error); return; }

    if (data && data.length > 0) {
      allPositions = [...allPositions, ...data];
      from += positionsBatchSize;
      hasMore = data.length === positionsBatchSize;
    } else {
      hasMore = false;
    }
  }

  console.log('Загружено позиций:', allPositions.length);
  const positionIds = allPositions.map(p => p.id);

  // 2. Загружаем boq_items батчами по 100 через .in()
  const boqBatchSize = 100;
  const batches = [];
  for (let i = 0; i < positionIds.length; i += boqBatchSize) {
    batches.push(positionIds.slice(i, i + boqBatchSize));
  }

  console.log('Батчей для загрузки boq_items:', batches.length);

  let allBoqData = [];
  for (const batch of batches) {
    const { data: boqData, error: boqError } = await supabase
      .from('boq_items')
      .select('client_position_id, boq_item_type, total_amount')
      .in('client_position_id', batch);

    if (boqError) { console.error('Ошибка:', boqError); return; }
    allBoqData = [...allBoqData, ...(boqData || [])];
  }

  console.log('Загружено boq_items:', allBoqData.length);

  // 3. Подсчёт суммы (как в useClientPositions)
  let sum = 0;
  allBoqData.forEach((item) => {
    const itemTotal = item.total_amount || 0;
    sum += itemTotal;
  });

  console.log('Сумма (useClientPositions):', sum.toLocaleString('ru-RU'));
  console.log('После Math.round:', Math.round(sum).toLocaleString('ru-RU'));

  // ======= СИМУЛЯЦИЯ СТРАНИЦЫ "КОММЕРЦИЯ" =======
  console.log('\n=== Симуляция useCommerceData ===');

  // Загружаем boq_items напрямую по tender_id
  let allItemsDirect = [];
  from = 0;
  hasMore = true;
  const batchSize = 1000;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('client_position_id, total_amount, total_commercial_material_cost, total_commercial_work_cost')
      .eq('tender_id', tenderId)
      .range(from, from + batchSize - 1);

    if (error) { console.error('Ошибка:', error); return; }

    if (data && data.length > 0) {
      allItemsDirect = [...allItemsDirect, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  console.log('Загружено boq_items:', allItemsDirect.length);

  // Подсчёт (как в useCommerceData - referenceTotal)
  const refTotal = allItemsDirect.reduce((s, item) => s + (item.total_amount || 0), 0);
  console.log('Сумма (useCommerceData referenceTotal):', refTotal.toLocaleString('ru-RU'));

  // ======= СРАВНЕНИЕ =======
  console.log('\n=== Сравнение ===');
  console.log('Позиции заказчика:', sum.toLocaleString('ru-RU'));
  console.log('Коммерция:        ', refTotal.toLocaleString('ru-RU'));
  console.log('Разница:          ', (refTotal - sum).toLocaleString('ru-RU'));
  console.log('Items разница:    ', allItemsDirect.length - allBoqData.length);

  // Проверяем какие items есть в коммерции но нет в позициях
  if (allItemsDirect.length !== allBoqData.length) {
    const positionIdsSet = new Set(positionIds);
    const missingFromPositions = allItemsDirect.filter(item => !positionIdsSet.has(item.client_position_id));
    console.log('\nItems с client_position_id НЕ в списке позиций:', missingFromPositions.length);
    if (missingFromPositions.length > 0) {
      const missingSum = missingFromPositions.reduce((s, item) => s + (item.total_amount || 0), 0);
      console.log('Сумма пропущенных:', missingSum.toLocaleString('ru-RU'));
    }
  }
}

checkDiff();
