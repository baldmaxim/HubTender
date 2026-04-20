/**
 * Проверка заполнения коммерческих полей в boq_items
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCommercialFields() {
  try {
    const { data: tenders } = await supabase
      .from('tenders')
      .select('*')
      .ilike('title', '%События%');

    const tender = tenders[0];
    console.log(`Тендер: ${tender.title}\n`);

    // Загрузить все элементы
    let allBoqItems = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .from('boq_items')
        .select('*')
        .eq('tender_id', tender.id)
        .range(from, from + batchSize - 1);

      if (data && data.length > 0) {
        allBoqItems = [...allBoqItems, ...data];
        from += batchSize;
        hasMore = data.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`Всего элементов: ${allBoqItems.length}\n`);

    // Статистика по заполненности полей
    let withCommercialMaterial = 0;
    let withCommercialWork = 0;
    let withoutCommercialMaterial = 0;
    let withoutCommercialWork = 0;
    let totalCommercialZero = 0;

    allBoqItems.forEach(item => {
      const mat = item.total_commercial_material_cost || 0;
      const work = item.total_commercial_work_cost || 0;

      if (mat > 0) withCommercialMaterial++;
      else withoutCommercialMaterial++;

      if (work > 0) withCommercialWork++;
      else withoutCommercialWork++;

      if (mat === 0 && work === 0) totalCommercialZero++;
    });

    console.log(`${'='.repeat(80)}`);
    console.log(`СТАТИСТИКА ЗАПОЛНЕННОСТИ КОММЕРЧЕСКИХ ПОЛЕЙ`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`total_commercial_material_cost:`);
    console.log(`  - С значением > 0: ${withCommercialMaterial} (${(withCommercialMaterial / allBoqItems.length * 100).toFixed(1)}%)`);
    console.log(`  - С значением = 0 или NULL: ${withoutCommercialMaterial} (${(withoutCommercialMaterial / allBoqItems.length * 100).toFixed(1)}%)\n`);

    console.log(`total_commercial_work_cost:`);
    console.log(`  - С значением > 0: ${withCommercialWork} (${(withCommercialWork / allBoqItems.length * 100).toFixed(1)}%)`);
    console.log(`  - С значением = 0 или NULL: ${withoutCommercialWork} (${(withoutCommercialWork / allBoqItems.length * 100).toFixed(1)}%)\n`);

    console.log(`Элементов где ОБА поля = 0: ${totalCommercialZero} (${(totalCommercialZero / allBoqItems.length * 100).toFixed(1)}%)\n`);

    // Группировка по типу
    const statsByType = {};

    allBoqItems.forEach(item => {
      const type = item.boq_item_type;
      if (!statsByType[type]) {
        statsByType[type] = {
          total: 0,
          withMat: 0,
          withWork: 0,
          bothZero: 0
        };
      }

      statsByType[type].total++;

      const mat = item.total_commercial_material_cost || 0;
      const work = item.total_commercial_work_cost || 0;

      if (mat > 0) statsByType[type].withMat++;
      if (work > 0) statsByType[type].withWork++;
      if (mat === 0 && work === 0) statsByType[type].bothZero++;
    });

    console.log(`${'='.repeat(80)}`);
    console.log(`СТАТИСТИКА ПО ТИПАМ`);
    console.log(`${'='.repeat(80)}\n`);

    Object.entries(statsByType).forEach(([type, stats]) => {
      console.log(`${type}:`);
      console.log(`  Всего: ${stats.total}`);
      console.log(`  С commercial_material > 0: ${stats.withMat} (${(stats.withMat / stats.total * 100).toFixed(1)}%)`);
      console.log(`  С commercial_work > 0: ${stats.withWork} (${(stats.withWork / stats.total * 100).toFixed(1)}%)`);
      console.log(`  Оба поля = 0: ${stats.bothZero} (${(stats.bothZero / stats.total * 100).toFixed(1)}%)\n`);
    });

    // Примеры элементов с нулевыми коммерческими полями
    console.log(`${'='.repeat(80)}`);
    console.log(`ПРИМЕРЫ ЭЛЕМЕНТОВ С НУЛЕВЫМИ КОММЕРЧЕСКИМИ ПОЛЯМИ`);
    console.log(`${'='.repeat(80)}\n`);

    const zeroExamples = allBoqItems.filter(item =>
      (item.total_commercial_material_cost || 0) === 0 &&
      (item.total_commercial_work_cost || 0) === 0
    ).slice(0, 10);

    zeroExamples.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.boq_item_type} - ${item.work_name || item.material_name || 'Без названия'}`);
      console.log(`   total_amount: ${(item.total_amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_commercial_material_cost: ${(item.total_commercial_material_cost || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_commercial_work_cost: ${(item.total_commercial_work_cost || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   created_at: ${item.created_at}`);
      console.log(`   updated_at: ${item.updated_at}\n`);
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

checkCommercialFields();
