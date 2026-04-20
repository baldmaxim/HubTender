const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Получаем все тендеры
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title')
    .order('created_at', { ascending: false });

  if (!tenders || tenders.length === 0) {
    console.log('Нет тендеров');
    return;
  }

  console.log('Найдено тендеров:', tenders.length);
  console.log('\nИтоговые суммы КП:\n');

  for (const tender of tenders) {
    // Получаем все boq_items для тендера с батчингом
    let from = 0;
    const batchSize = 1000;
    let allItems = [];
    let hasMore = true;

    while (hasMore) {
      const { data: boqItems } = await supabase
        .from('boq_items')
        .select('total_commercial_material_cost, total_commercial_work_cost')
        .eq('tender_id', tender.id)
        .range(from, from + batchSize - 1);

      if (boqItems && boqItems.length > 0) {
        allItems = [...allItems, ...boqItems];
        from += batchSize;
        hasMore = boqItems.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    const fullSum = allItems.reduce((sum, item) => {
      return sum + (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
    }, 0);

    // Проверим первые 3 записи для диагностики
    const sampleItems = allItems.slice(0, 3);

    console.log(`${tender.title}:`);
    console.log(`  ID: ${tender.id}`);
    console.log(`  BOQ items: ${allItems.length}`);
    console.log(`  Итоговая сумма КП: ${Math.round(fullSum).toLocaleString('ru-RU')}`);
    if (fullSum === 0 && allItems.length > 0) {
      console.log(`  ВНИМАНИЕ: Сумма 0 при наличии элементов!`);
      console.log(`  Первые 3 элемента:`, sampleItems.map(item => ({
        type: item.boq_item_type,
        mat_cost: item.total_commercial_material_cost,
        work_cost: item.total_commercial_work_cost,
        total_amount: item.total_amount
      })));
    }
    console.log('');
  }
})();
