const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function checkExclusions() {
  console.log('🔍 Проверка исключений роста субподряда...\n');

  // Загрузить исключения
  const { data: exclusions, error: exError } = await supabase
    .from('subcontract_growth_exclusions')
    .select('*')
    .eq('tender_id', TENDER_ID);

  if (exError) {
    console.error('Ошибка загрузки исключений:', exError);
    return;
  }

  console.log(`📋 Исключений роста субподряда: ${exclusions?.length || 0}\n`);

  if (exclusions && exclusions.length > 0) {
    const workExclusions = exclusions.filter(e => e.exclusion_type === 'works');
    const materialExclusions = exclusions.filter(e => e.exclusion_type === 'materials');

    console.log(`  Работы: ${workExclusions.length}`);
    console.log(`  Материалы: ${materialExclusions.length}\n`);

    if (materialExclusions.length > 0) {
      console.log('Категории затрат с исключением для материалов:');
      for (const exc of materialExclusions) {
        // Получить название категории
        const { data: category } = await supabase
          .from('detail_cost_categories')
          .select('name, location, cost_categories(name)')
          .eq('id', exc.detail_cost_category_id)
          .single();

        console.log(`  ${category?.cost_categories?.name || 'Unknown'} - ${category?.name || 'Unknown'} (${category?.location || 'Unknown'})`);
      }

      // Найти элементы суб-мат_основн. с этими категориями
      const categoryIds = materialExclusions.map(e => e.detail_cost_category_id);

      let allBoqItems = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('boq_items')
          .select('id, boq_item_type, material_type, detail_cost_category_id, total_amount, total_commercial_material_cost, total_commercial_work_cost')
          .eq('tender_id', TENDER_ID)
          .eq('boq_item_type', 'суб-мат')
          .eq('material_type', 'основн.')
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

      const excludedElements = allBoqItems.filter(item =>
        item.detail_cost_category_id && categoryIds.includes(item.detail_cost_category_id)
      );

      console.log(`\n⚠️  Элементов суб-мат_основн. с исключением: ${excludedElements.length}`);

      if (excludedElements.length > 0) {
        // Проверка коэффициента
        const EXCLUDED_COEFF = 1.1 * 1.16; // Без роста субмат (10%)
        const FULL_COEFF = 1.1 * 1.1 * 1.16; // С ростом субмат

        console.log(`\nОжидаемый коэффициент БЕЗ роста: ${EXCLUDED_COEFF.toFixed(6)} (1.1 * 1.16)`);
        console.log(`Ожидаемый коэффициент С ростом: ${FULL_COEFF.toFixed(6)} (1.1 * 1.1 * 1.16)\n`);

        const stats = excludedElements.reduce((acc, item) => {
          const base = item.total_amount || 0;
          const commercial = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
          const coeff = base > 0 ? commercial / base : 0;

          acc.totalBase += base;
          acc.totalCommercial += commercial;
          acc.avgCoeff += coeff;
          acc.count++;

          return acc;
        }, { totalBase: 0, totalCommercial: 0, avgCoeff: 0, count: 0 });

        stats.avgCoeff /= stats.count;

        console.log(`База: ${stats.totalBase.toFixed(2)}`);
        console.log(`Commercial: ${stats.totalCommercial.toFixed(2)}`);
        console.log(`Средний коэффициент: ${stats.avgCoeff.toFixed(6)}`);

        // Ожидаемая commercial с исключением
        const expectedCommercial = stats.totalBase * EXCLUDED_COEFF;
        const expectedError = expectedCommercial - stats.totalCommercial;

        console.log(`\nОжидаемая commercial (БЕЗ роста): ${expectedCommercial.toFixed(2)}`);
        console.log(`Разница: ${expectedError.toFixed(2)}`);

        // Ожидаемая commercial с полным коэффициентом
        const expectedCommercialFull = stats.totalBase * FULL_COEFF;
        const errorIfNoExclusion = expectedCommercialFull - stats.totalCommercial;

        console.log(`\nЕсли применить полный рост: ${expectedCommercialFull.toFixed(2)}`);
        console.log(`Прирост: ${errorIfNoExclusion.toFixed(2)}`);
        console.log(`\nОжидаемая общая разница: 603,187.59`);
      }
    }
  } else {
    console.log('Исключений не найдено.');
  }
}

checkExclusions().catch(console.error);
