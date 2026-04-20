const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function compareCostsCommerce() {
  console.log('🔍 Сравнение сумм /costs vs /commerce\n');

  // Загрузка всех BOQ элементов с батчингом
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

  console.log(`Загружено элементов: ${allBoqItems.length}\n`);

  // === РАСЧЕТ ДЛЯ COMMERCE PAGE ===
  let commerceMaterials = 0;
  let commerceWorks = 0;

  allBoqItems.forEach(item => {
    const itemBase = item.total_amount || 0;
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;

    // Вспомогательные: всё в работы
    if (item.material_type === 'вспомогат.') {
      commerceWorks += itemBase + mat + work;
    }
    // Основные: база в материалы, наценки в работы
    else if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
      commerceMaterials += itemBase;
      commerceWorks += mat + work;
    }
    // Работы: всё в работы
    else {
      commerceWorks += itemBase + mat + work;
    }
  });

  const commerceTotal = commerceMaterials + commerceWorks;

  console.log('=== COMMERCE PAGE ===');
  console.log(`Материалы КП: ${commerceMaterials.toFixed(2)}`);
  console.log(`Работы КП: ${commerceWorks.toFixed(2)}`);
  console.log(`Итого: ${commerceTotal.toFixed(2)}`);
  console.log('');

  // === РАСЧЕТ ДЛЯ COSTS PAGE ===
  const costsMap = {
    materials: 0,
    works: 0,
    subMaterials: 0,
    subWorks: 0,
    materialsComp: 0,
    worksComp: 0,
  };

  allBoqItems.forEach(item => {
    const itemBase = item.total_amount || 0;
    const materialCost = item.total_commercial_material_cost || 0;
    const workCost = item.total_commercial_work_cost || 0;

    // Вспомогательные материалы: всё в работы
    if (item.material_type === 'вспомогат.') {
      if (item.boq_item_type === 'мат') {
        costsMap.works += itemBase + materialCost + workCost;
      } else if (item.boq_item_type === 'суб-мат') {
        costsMap.subWorks += itemBase + materialCost + workCost;
      } else if (item.boq_item_type === 'мат-комп.') {
        costsMap.worksComp += itemBase + materialCost + workCost;
      }
    }
    // Основные материалы: база в материалы, наценки в работы
    else if (item.boq_item_type === 'мат') {
      costsMap.materials += itemBase;
      costsMap.works += materialCost + workCost;
    }
    else if (item.boq_item_type === 'суб-мат') {
      costsMap.subMaterials += itemBase;
      costsMap.subWorks += materialCost + workCost;
    }
    else if (item.boq_item_type === 'мат-комп.') {
      costsMap.materialsComp += itemBase;
      costsMap.worksComp += materialCost + workCost;
    }
    // Работы: всё в работы
    else if (item.boq_item_type === 'раб') {
      costsMap.works += itemBase + materialCost + workCost;
    }
    else if (item.boq_item_type === 'суб-раб') {
      costsMap.subWorks += itemBase + materialCost + workCost;
    }
    else if (item.boq_item_type === 'раб-комп.') {
      costsMap.worksComp += itemBase + materialCost + workCost;
    }
  });

  const costsTotal = costsMap.materials + costsMap.works + costsMap.subMaterials +
                     costsMap.subWorks + costsMap.materialsComp + costsMap.worksComp;

  console.log('=== COSTS PAGE ===');
  console.log(`Материалы: ${costsMap.materials.toFixed(2)}`);
  console.log(`Работы: ${costsMap.works.toFixed(2)}`);
  console.log(`Субподряд мат: ${costsMap.subMaterials.toFixed(2)}`);
  console.log(`Субподряд раб: ${costsMap.subWorks.toFixed(2)}`);
  console.log(`Комп. мат: ${costsMap.materialsComp.toFixed(2)}`);
  console.log(`Комп. раб: ${costsMap.worksComp.toFixed(2)}`);
  console.log(`Итого: ${costsTotal.toFixed(2)}`);
  console.log('');

  // === СРАВНЕНИЕ ===
  console.log('=== СРАВНЕНИЕ ===');
  console.log(`Разница в итого: ${(commerceTotal - costsTotal).toFixed(2)}`);
  console.log(`Ожидаемое итого: 5,613,631,822`);
  console.log(`Commerce итого: ${commerceTotal.toFixed(2)}`);
  console.log(`Costs итого: ${costsTotal.toFixed(2)}`);

  if (Math.abs(commerceTotal - costsTotal) < 10) {
    console.log('✅ Суммы сходятся!');
  } else {
    console.log('❌ Есть расхождение!');
  }
}

compareCostsCommerce().catch(console.error);
