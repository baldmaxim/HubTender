const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function verifyDistributionMatch() {
  console.log('🔍 Проверка соответствия распределения\n');

  // Загрузка всех BOQ элементов
  let allBoqItems = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select(`
        boq_item_type,
        material_type,
        total_amount,
        total_commercial_material_cost,
        total_commercial_work_cost,
        client_positions!inner(tender_id)
      `)
      .eq('client_positions.tender_id', TENDER_ID)
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

  // === COMMERCE LOGIC ===
  let commerceMaterialsKP = 0;

  allBoqItems.forEach(item => {
    const itemBase = item.total_amount || 0;

    // Материалы КП = БАЗА основных материалов
    if (item.material_type !== 'вспомогат.' &&
        (item.boq_item_type === 'мат' || item.boq_item_type === 'суб-мат' || item.boq_item_type === 'мат-комп.')) {
      commerceMaterialsKP += itemBase;
    }
  });

  // === COSTS LOGIC ===
  let costsMaterials = 0;
  let costsSubMaterials = 0;
  let costsMaterialsComp = 0;

  allBoqItems.forEach(item => {
    const itemBase = item.total_amount || 0;
    const materialCost = item.total_commercial_material_cost || 0;
    const workCost = item.total_commercial_work_cost || 0;

    // Вспомогательные: пропускаем (они идут в работы)
    if (item.material_type === 'вспомогат.') {
      return;
    }

    // Основные материалы: база в материалы
    if (item.boq_item_type === 'мат') {
      costsMaterials += itemBase;
    }
    else if (item.boq_item_type === 'суб-мат') {
      costsSubMaterials += itemBase;
    }
    else if (item.boq_item_type === 'мат-комп.') {
      costsMaterialsComp += itemBase;
    }
  });

  const costsTotalMaterials = costsMaterials + costsSubMaterials + costsMaterialsComp;

  console.log('=== COMMERCE ===');
  console.log(`Материалы КП: ${commerceMaterialsKP.toFixed(2)}`);
  console.log('');

  console.log('=== COSTS ===');
  console.log(`Материалы: ${costsMaterials.toFixed(2)}`);
  console.log(`Суб-материалы: ${costsSubMaterials.toFixed(2)}`);
  console.log(`Комп. материалы: ${costsMaterialsComp.toFixed(2)}`);
  console.log(`Итого материалы: ${costsTotalMaterials.toFixed(2)}`);
  console.log('');

  console.log('=== СРАВНЕНИЕ ===');
  const diff = commerceMaterialsKP - costsTotalMaterials;
  console.log(`Разница: ${diff.toFixed(2)}`);

  if (Math.abs(diff) < 1) {
    console.log('✅ Материалы сходятся!');
  } else {
    console.log('❌ Есть расхождение в материалах');
  }

  // Проверка ИТОГО
  const commerceTotal = allBoqItems.reduce((sum, item) => {
    return sum + (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
  }, 0);

  console.log('');
  console.log('=== ИТОГО ===');
  console.log(`Коммерческая сумма: ${commerceTotal.toFixed(2)}`);
  console.log(`Ожидается: 5,613,631,822`);
  console.log(`Разница: ${(5613631822 - commerceTotal).toFixed(2)}`);
}

verifyDistributionMatch().catch(console.error);
