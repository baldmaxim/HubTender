const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe'; // ЖК Событие 6.2

async function recalculateTender() {
  console.log('🚀 Запуск пересчета с исправленной логикой...');
  console.log('Тендер ID:', TENDER_ID);

  // Вызов RPC функции для пересчета
  const { data, error } = await supabase
    .rpc('recalculate_boq_items_for_tender', {
      tender_id_param: TENDER_ID
    });

  if (error) {
    console.error('❌ Ошибка пересчета:', error);
    return;
  }

  console.log('✅ Пересчет завершен!');
  console.log('Обновлено элементов:', data);

  // Проверка итоговых сумм
  console.log('\n📊 Проверка итоговых сумм...');

  let allBoqItems = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('total_amount, total_commercial_material_cost, total_commercial_work_cost')
      .eq('tender_id', TENDER_ID)
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Ошибка загрузки:', error);
      return;
    }

    if (data && data.length > 0) {
      allBoqItems = [...allBoqItems, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  const baseTotal = allBoqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
  const matTotal = allBoqItems.reduce((sum, item) => sum + (item.total_commercial_material_cost || 0), 0);
  const workTotal = allBoqItems.reduce((sum, item) => sum + (item.total_commercial_work_cost || 0), 0);
  const commercialTotal = matTotal + workTotal;

  console.log('\n=== ИТОГОВЫЕ СУММЫ ===');
  console.log('Базовая:           ', baseTotal.toLocaleString('ru-RU'));
  console.log('Материалы com:     ', matTotal.toLocaleString('ru-RU'));
  console.log('Работы com:        ', workTotal.toLocaleString('ru-RU'));
  console.log('Commercial ИТОГО:  ', commercialTotal.toLocaleString('ru-RU'));
  console.log('\n=== СРАВНЕНИЕ ===');
  console.log('Ожидается:         ', '5,613,631,822');
  console.log('Фактически:        ', commercialTotal.toLocaleString('ru-RU'));
  const diff = 5613631822 - commercialTotal;
  console.log('Разница:           ', diff.toLocaleString('ru-RU'), diff > 0 ? '(недостает)' : '(переизбыток)');
  console.log('Процент:           ', ((diff / 5613631822) * 100).toFixed(4), '%');
}

recalculateTender().catch(console.error);
