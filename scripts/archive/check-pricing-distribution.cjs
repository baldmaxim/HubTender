const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe'; // ЖК Событие 6.2

async function checkPricingDistribution() {
  const { data, error } = await supabase
    .from('tender_pricing_distribution')
    .select('*')
    .eq('tender_id', TENDER_ID)
    .single();

  if (error || !data) {
    console.log('❌ Настройки pricing_distribution НЕ НАЙДЕНЫ для тендера');
    console.log('⚠️  Используется старая логика без учета material_type');
    console.log('\nЭто означает, что:');
    console.log('- Все мат/суб-мат/мат-комп. → materialCost');
    console.log('- Все раб/суб-раб/раб-комп. → workCost');
    console.log('- НЕТ различия между основн. и вспомогат. материалами!');
    return;
  }

  console.log('✅ Настройки pricing_distribution найдены:');
  console.table([
    { field: 'basic_material_base_target', value: data.basic_material_base_target },
    { field: 'basic_material_markup_target', value: data.basic_material_markup_target },
    { field: 'auxiliary_material_base_target', value: data.auxiliary_material_base_target },
    { field: 'auxiliary_material_markup_target', value: data.auxiliary_material_markup_target },
    { field: 'subcontract_basic_material_base_target', value: data.subcontract_basic_material_base_target },
    { field: 'subcontract_basic_material_markup_target', value: data.subcontract_basic_material_markup_target },
    { field: 'subcontract_auxiliary_material_base_target', value: data.subcontract_auxiliary_material_base_target },
    { field: 'subcontract_auxiliary_material_markup_target', value: data.subcontract_auxiliary_material_markup_target },
    { field: 'work_base_target', value: data.work_base_target },
    { field: 'work_markup_target', value: data.work_markup_target },
  ]);
}

checkPricingDistribution().catch(console.error);
