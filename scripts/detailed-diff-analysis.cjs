const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';
const EXPECTED_TOTAL = 5613631822.22; // из Financial Indicators

async function analyzeDetailedDiff() {
  console.log('🔍 Детальный анализ разницы...\n');

  // Загрузка всех элементов
  let allBoqItems = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('*')
      .eq('tender_id', TENDER_ID)
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Ошибка:', error);
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

  console.log(`📝 Загружено элементов: ${allBoqItems.length}\n`);

  // Проверка элементов с base=0 и commercial>0
  const zeroBaseWithCommercial = allBoqItems.filter(item => {
    const base = item.total_amount || 0;
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;
    return base === 0 && (mat > 0 || work > 0);
  });

  if (zeroBaseWithCommercial.length > 0) {
    console.log(`⚠️  Элементов с base=0 и commercial>0: ${zeroBaseWithCommercial.length}`);
    const commercialSum = zeroBaseWithCommercial.reduce((sum, item) =>
      sum + (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0), 0
    );
    console.log(`   Commercial сумма: ${commercialSum.toLocaleString('ru-RU')}\n`);
  }

  // Проверка элементов с base>0 и commercial=0
  const baseWithoutCommercial = allBoqItems.filter(item => {
    const base = item.total_amount || 0;
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;
    return base > 0 && (mat === 0 && work === 0);
  });

  if (baseWithoutCommercial.length > 0) {
    console.log(`⚠️  Элементов с base>0 и commercial=0: ${baseWithoutCommercial.length}`);
    const baseSum = baseWithoutCommercial.reduce((sum, item) => sum + (item.total_amount || 0), 0);
    console.log(`   Базовая сумма: ${baseSum.toLocaleString('ru-RU')}\n`);
  }

  // Подсчет сумм
  const baseTotal = allBoqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
  const matTotal = allBoqItems.reduce((sum, item) => sum + (item.total_commercial_material_cost || 0), 0);
  const workTotal = allBoqItems.reduce((sum, item) => sum + (item.total_commercial_work_cost || 0), 0);
  const commercialTotal = matTotal + workTotal;

  console.log('=== СУММЫ ===');
  console.log(`Базовая:          ${baseTotal.toFixed(2)}`);
  console.log(`Материалы com:    ${matTotal.toFixed(2)}`);
  console.log(`Работы com:       ${workTotal.toFixed(2)}`);
  console.log(`Commercial ИТОГО: ${commercialTotal.toFixed(2)}`);
  console.log(`Ожидается:        ${EXPECTED_TOTAL.toFixed(2)}`);
  console.log(`Разница:          ${(EXPECTED_TOTAL - commercialTotal).toFixed(2)}\n`);

  // Проверка округлений
  const markups = commercialTotal - baseTotal;
  console.log('=== НАЦЕНКИ ===');
  console.log(`Наценки (com-base): ${markups.toFixed(2)}`);
  console.log(`Ожидаемые наценки: ${(EXPECTED_TOTAL - baseTotal).toFixed(2)}`);
  console.log(`Разница в наценках: ${(EXPECTED_TOTAL - baseTotal - markups).toFixed(2)}\n`);

  // Статистика по типам с высокой точностью
  console.log('=== РАЗБИВКА ПО ТИПАМ (высокая точность) ===');
  const byType = {};
  allBoqItems.forEach(item => {
    const key = `${item.boq_item_type}${item.material_type ? `_${item.material_type}` : ''}`;
    if (!byType[key]) {
      byType[key] = { count: 0, base: 0, mat: 0, work: 0 };
    }
    byType[key].count++;
    byType[key].base += item.total_amount || 0;
    byType[key].mat += item.total_commercial_material_cost || 0;
    byType[key].work += item.total_commercial_work_cost || 0;
  });

  Object.entries(byType).forEach(([type, stats]) => {
    const commercial = stats.mat + stats.work;
    const markup = commercial - stats.base;
    console.log(`\n${type}:`);
    console.log(`  Элементов: ${stats.count}`);
    console.log(`  База:      ${stats.base.toFixed(2)}`);
    console.log(`  Mat:       ${stats.mat.toFixed(2)}`);
    console.log(`  Work:      ${stats.work.toFixed(2)}`);
    console.log(`  Com:       ${commercial.toFixed(2)}`);
    console.log(`  Markup:    ${markup.toFixed(2)} (${((markup / stats.base) * 100).toFixed(4)}%)`);
  });

  // Проверка элементов с нестандартными наценками
  console.log('\n=== АНАЛИЗ НАЦЕНОК ===');
  const markupRatios = allBoqItems
    .filter(item => (item.total_amount || 0) > 0)
    .map(item => {
      const base = item.total_amount || 0;
      const commercial = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
      return {
        id: item.id.substring(0, 8),
        type: item.boq_item_type,
        mat_type: item.material_type,
        base,
        commercial,
        ratio: commercial / base,
        markup: commercial - base
      };
    })
    .sort((a, b) => a.ratio - b.ratio);

  // Минимальные и максимальные коэффициенты
  console.log('Минимальные коэффициенты наценок:');
  console.table(markupRatios.slice(0, 5));
  console.log('\nМаксимальные коэффициенты наценок:');
  console.table(markupRatios.slice(-5));
}

analyzeDetailedDiff().catch(console.error);
