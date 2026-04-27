const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function checkOneElement() {
  console.log('🔍 Проверка одного элемента с коэффициентом 1.344431...\n');

  // Найти элементы с коэффициентом близким к 1.344431
  let allBoqItems = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('*')
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

  const WRONG_COEFF = 1.344431;
  const TOLERANCE = 0.00001;

  const wrongElements = allBoqItems.filter(item => {
    const base = item.total_amount || 0;
    if (base === 0) return false;
    const commercial = (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0);
    const coeff = commercial / base;
    return Math.abs(coeff - WRONG_COEFF) < TOLERANCE;
  });

  console.log(`Найдено элементов с коэффициентом ${WRONG_COEFF}: ${wrongElements.length}\n`);

  if (wrongElements.length > 0) {
    const item = wrongElements[0];
    const base = item.total_amount || 0;
    const mat = item.total_commercial_material_cost || 0;
    const work = item.total_commercial_work_cost || 0;
    const commercial = mat + work;
    const coeff = commercial / base;

    console.log('Детали элемента:');
    console.log(`ID: ${item.id}`);
    console.log(`Updated: ${item.updated_at}`);
    console.log(`Detail cost category: ${item.detail_cost_category_id || 'NULL'}`);
    console.log(`\nБаза: ${base}`);
    console.log(`Mat: ${mat}`);
    console.log(`Work: ${work}`);
    console.log(`Commercial: ${commercial}`);
    console.log(`Коэффициент: ${coeff.toFixed(6)}`);

    console.log(`\n=== ОЖИДАЕМЫЙ РАСЧЕТ ===`);
    console.log('1. Рост субмат (10%): base × 1.1');
    const step1 = base * 1.1;
    console.log(`   ${base} × 1.1 = ${step1}`);

    console.log('2. ООЗ субмат (10%): step1 × 1.1');
    const step2 = step1 * 1.1;
    console.log(`   ${step1} × 1.1 = ${step2}`);

    console.log('3. Прибыль субподряд (16%): step2 × 1.16');
    const step3 = step2 * 1.16;
    console.log(`   ${step2} × 1.16 = ${step3}`);

    const expectedCommercial = step3;
    const expectedCoeff = expectedCommercial / base;

    console.log(`\nОжидаемая commercial: ${expectedCommercial}`);
    console.log(`Ожидаемый коэффициент: ${expectedCoeff.toFixed(6)}`);
    console.log(`Разница: ${(expectedCommercial - commercial).toFixed(2)}`);

    console.log(`\n=== ПРОВЕРКА ФОРМУЛЫ ===`);
    console.log(`1.1 × 1.1 × 1.16 = ${(1.1 * 1.1 * 1.16).toFixed(6)}`);
    console.log(`Фактический коэфф: ${coeff.toFixed(6)}`);

    // Какая формула дает 1.344431?
    console.log(`\n=== ОБРАТНЫЙ РАСЧЕТ ===`);
    console.log(`commercial / base = ${coeff}`);
    console.log(`Проверим варианты:`);
    console.log(`1.1 × 1.16 = ${(1.1 * 1.16).toFixed(6)} (без роста субмат)`);
    console.log(`1.1 × 1.1 = ${(1.1 * 1.1).toFixed(6)}`);
    console.log(`1.16 × 1.16 = ${(1.16 * 1.16).toFixed(6)}`);

    // Получить категорию затрат
    if (item.detail_cost_category_id) {
      const { data: category } = await supabase
        .from('detail_cost_categories')
        .select('*, cost_categories(*)')
        .eq('id', item.detail_cost_category_id)
        .single();

      console.log(`\n=== КАТЕГОРИЯ ЗАТРАТ ===`);
      console.log(`Категория: ${category?.cost_categories?.name || 'Unknown'}`);
      console.log(`Деталь: ${category?.name || 'Unknown'}`);
      console.log(`Локация: ${category?.location || 'Unknown'}`);
    }
  }
}

checkOneElement().catch(console.error);
