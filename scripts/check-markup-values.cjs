const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe'; // ЖК Событие 6.2

async function checkMarkupValues() {
  // Получить значения наценок для тендера
  const { data: values, error: valuesError } = await supabase
    .from('tender_markup_percentage')
    .select('*, markup_parameter:markup_parameters(key, label)')
    .eq('tender_id', TENDER_ID);

  if (valuesError) {
    console.error('❌ Ошибка загрузки значений:', valuesError);
    return;
  }

  console.log(`\n💰 Значения наценок для тендера (${values?.length || 0}):`);
  console.table(values?.map(v => ({
    key: v.markup_parameter?.key,
    label: v.markup_parameter?.label,
    value: `${v.value}%`
  })));

  // Ключевые параметры из Financial Indicators
  const keyParams = [
    'mechanization_service',
    'mbp_gsm',
    'warranty_period',
    'works_16_markup',
    'material_cost_growth',
    'works_cost_growth',
    'subcontract_materials_cost_growth',
    'subcontract_works_cost_growth',
    'contingency_costs',
    'overhead_own_forces',
    'overhead_subcontract',
    'general_costs_without_subcontract',
    'profit_own_forces',
    'profit_subcontract'
  ];

  console.log('\n📊 Проверка ключевых параметров:');
  const foundKeys = values?.map(v => v.markup_parameter?.key).filter(Boolean);
  keyParams.forEach(key => {
    const found = foundKeys?.includes(key);
    console.log(`${found ? '✅' : '❌'} ${key}`);
  });
}

checkMarkupValues().catch(console.error);
