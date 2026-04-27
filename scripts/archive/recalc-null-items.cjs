const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe'; // ЖК Событие 6.2

async function recalculateNullItems() {
  console.log('🔍 Поиск элементов с NULL в commercial полях...');

  // Найти все элементы с NULL
  const { data: nullItems, error: fetchError } = await supabase
    .from('boq_items')
    .select('id, client_position_id, boq_item_type, material_type, total_amount, client_positions!inner(tender_id)')
    .eq('client_positions.tender_id', TENDER_ID)
    .or('total_commercial_material_cost.is.null,total_commercial_work_cost.is.null');

  if (fetchError) {
    console.error('❌ Ошибка загрузки:', fetchError);
    return;
  }

  console.log(`📋 Найдено элементов с NULL: ${nullItems?.length || 0}`);

  if (!nullItems || nullItems.length === 0) {
    console.log('✅ Элементов с NULL не найдено');
    return;
  }

  // Показать детали
  console.table(nullItems.map(item => ({
    id: item.id.substring(0, 8) + '...',
    type: item.boq_item_type,
    material_type: item.material_type,
    base: item.total_amount
  })));

  // Получить тактику тендера
  const { data: tender, error: tenderError } = await supabase
    .from('tenders')
    .select('id, title, markup_tactic_id')
    .eq('id', TENDER_ID)
    .single();

  if (tenderError || !tender) {
    console.error('❌ Ошибка загрузки тендера:', tenderError);
    return;
  }

  console.log(`\n📊 Тендер: ${tender.title}`);
  console.log(`🎯 Тактика наценок: ${tender.markup_tactic_id || 'НЕ ЗАДАНА'}`);

  if (!tender.markup_tactic_id) {
    console.log('\n⚠️  У тендера не задана тактика наценок!');
    console.log('Необходимо выбрать тактику на странице /commerce/proposal');
    return;
  }

  console.log('\n💡 Для пересчета выполните SQL в Supabase SQL Editor:');
  console.log(`
-- Пересчет элементов с NULL commercial полями
SELECT recalculate_boq_items_for_tender('${TENDER_ID}');
  `);

  console.log('\nИли выполните пересчет через UI на странице /commerce/proposal');
}

recalculateNullItems().catch(console.error);
