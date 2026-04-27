const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Найти первый тендер Адмирал
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title')
    .ilike('title', '%Адмирал%')
    .order('created_at', { ascending: true })
    .limit(1);

  const tender = tenders?.[0];

  console.log('Tender:', tender);

  if (!tender) return;

  // Найти все позиции для тендера
  const { data: positions } = await supabase
    .from('client_positions')
    .select('id, position_number, work_name')
    .eq('tender_id', tender.id)
    .order('position_number');

  // Найти позиции со словом "тестовая"
  const testPositions = positions?.filter(p =>
    p.work_name?.toLowerCase().includes('тестовая')
  );

  console.log(`\nТестовые позиции (${testPositions?.length}):`);
  testPositions?.forEach(p => {
    console.log(`${p.position_number}: ${p.work_name} (id: ${p.id})`);
  });

  // Использовать первую тестовую позицию
  const position = testPositions?.[0];

  if (!position) {
    console.log('Тестовая позиция не найдена');
    return;
  }

  console.log('\nИспользуем позицию:', position.work_name);

  // Загрузить audit записи для этой позиции
  const { data: auditRecords } = await supabase
    .from('boq_items_audit')
    .select('id, operation_type, changed_at, changed_by, old_data, new_data')
    .or(`new_data->>client_position_id.eq.${position.id},old_data->>client_position_id.eq.${position.id}`)
    .order('changed_at', { ascending: false })
    .limit(50);

  console.log('\nAudit records count:', auditRecords?.length);
  console.log('\n=== All Records ===');
  auditRecords?.forEach(r => {
    const itemType = r.old_data?.boq_item_type || r.new_data?.boq_item_type;
    const workName = r.old_data?.work_name || r.new_data?.work_name;
    const materialName = r.old_data?.material_name || r.new_data?.material_name;
    const itemName = workName || materialName || 'N/A';
    console.log(`[${r.operation_type}] ${r.changed_at} | changed_by: ${r.changed_by || 'NULL'} | type: ${itemType} | name: ${itemName.substring(0, 50)}`);
  });

  // Статистика
  const withUser = auditRecords?.filter(r => r.changed_by).length || 0;
  const withoutUser = auditRecords?.filter(r => !r.changed_by).length || 0;
  console.log(`\n=== Статистика ===`);
  console.log(`С автором: ${withUser}`);
  console.log(`Без автора (системные): ${withoutUser}`);

  // Группировка по типу операции
  const byOperation = {};
  auditRecords?.forEach(r => {
    if (!byOperation[r.operation_type]) {
      byOperation[r.operation_type] = { withUser: 0, withoutUser: 0 };
    }
    if (r.changed_by) {
      byOperation[r.operation_type].withUser++;
    } else {
      byOperation[r.operation_type].withoutUser++;
    }
  });

  console.log('\n=== По типам операций ===');
  Object.entries(byOperation).forEach(([op, stats]) => {
    console.log(`${op}: с автором ${stats.withUser}, без автора ${stats.withoutUser}`);
  });
})();
