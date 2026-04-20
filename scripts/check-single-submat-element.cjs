const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function checkSingleElement() {
  console.log('🔍 Проверка одного элемента суб-мат_основн....\n');

  // Найти один элемент суб-мат_основн.
  const { data, error } = await supabase
    .from('boq_items')
    .select('*')
    .eq('tender_id', TENDER_ID)
    .eq('boq_item_type', 'суб-мат')
    .eq('material_type', 'основн.')
    .limit(1)
    .single();

  if (error || !data) {
    console.error('Ошибка:', error);
    return;
  }

  const item = data;
  console.log('Элемент:', item.id.substring(0, 8));
  console.log('Базовая стоимость:', item.total_amount);
  console.log('Commercial mat:', item.total_commercial_material_cost);
  console.log('Commercial work:', item.total_commercial_work_cost);
  console.log('Commercial total:', (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0));
  console.log('Коэффициент:', ((item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0)) / (item.total_amount || 1));

  console.log('\n=== ОЖИДАЕМЫЙ РАСЧЕТ ===');
  const base = item.total_amount || 0;

  // Последовательность для суб-мат:
  // 1. Рост субмат 10%
  const step1 = base * 1.1;
  console.log('После роста субмат (10%):', step1);

  // 2. ООЗ субмат 10%
  const step2 = step1 * 1.1;
  console.log('После ООЗ субмат (10%):', step2);

  // 3. Прибыль субподряд 16%
  const step3 = step2 * 1.16;
  console.log('После прибыль субподряд (16%):', step3);

  const expectedCommercial = step3;
  const expectedCoeff = expectedCommercial / base;

  console.log('\nОжидаемая commercial:', expectedCommercial);
  console.log('Ожидаемый коэффициент:', expectedCoeff);
  console.log('Разница:', expectedCommercial - ((item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0)));

  console.log('\n=== ПРЯМОЙ РАСЧЕТ ===');
  const directCalc = base * 1.1 * 1.1 * 1.16;
  console.log('base * 1.1 * 1.1 * 1.16:', directCalc);
  console.log('1.1 * 1.1 * 1.16 =', 1.1 * 1.1 * 1.16);
}

checkSingleElement().catch(console.error);
