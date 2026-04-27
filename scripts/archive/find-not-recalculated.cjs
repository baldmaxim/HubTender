const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function findNotRecalculated() {
  console.log('🔍 Поиск элементов, которые НЕ пересчитались...\n');

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

  // Проверка времени обновления
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 15 * 60 * 1000); // 15 минут назад

  const oldElements = allBoqItems.filter(item => {
    const updated = new Date(item.updated_at);
    return updated < recentCutoff;
  });

  console.log(`📊 Всего элементов: ${allBoqItems.length}`);
  console.log(`⏰ НЕ обновлены в последние 15 минут: ${oldElements.length}\n`);

  if (oldElements.length > 0) {
    // Группировка по типам
    const byType = {};
    oldElements.forEach(item => {
      const key = `${item.boq_item_type}${item.material_type ? `_${item.material_type}` : ''}`;
      if (!byType[key]) {
        byType[key] = { count: 0, base: 0, commercial: 0 };
      }
      byType[key].count++;
      byType[key].base += item.total_amount || 0;
      byType[key].commercial += (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
    });

    console.log('Разбивка старых элементов по типам:');
    console.table(byType);

    // Проверка коэффициентов для суб-мат_основн.
    const oldSubMat = oldElements.filter(item =>
      item.boq_item_type === 'суб-мат' && item.material_type === 'основн.'
    );

    if (oldSubMat.length > 0) {
      console.log(`\n⚠️  Старых суб-мат_основн.: ${oldSubMat.length}`);

      const WRONG_COEFF = 1.344431;
      const EXPECTED_COEFF = 1.403600;

      const withWrongCoeff = oldSubMat.filter(item => {
        const base = item.total_amount || 0;
        if (base === 0) return false;
        const commercial = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
        const coeff = commercial / base;
        return Math.abs(coeff - WRONG_COEFF) < 0.00001;
      });

      console.log(`С коэффициентом ${WRONG_COEFF}: ${withWrongCoeff.length}`);

      const totalError = withWrongCoeff.reduce((sum, item) => {
        const base = item.total_amount || 0;
        const commercial = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
        const expectedCommercial = base * EXPECTED_COEFF;
        return sum + (expectedCommercial - commercial);
      }, 0);

      console.log(`Суммарная ошибка от старых элементов: ${totalError.toFixed(2)}`);
      console.log(`Ожидаемая общая разница: 603,187.59`);
    }

    // Список ID для повторного пересчета
    console.log(`\n📝 ID старых элементов (первые 20):`);
    oldElements.slice(0, 20).forEach(item => {
      console.log(`  ${item.id.substring(0, 8)} - ${item.boq_item_type} ${item.material_type || ''} - Updated: ${item.updated_at}`);
    });
  }
}

findNotRecalculated().catch(console.error);
