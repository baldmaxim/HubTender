const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Найти все тендеры Адмирал
  const { data: tenders } = await supabase
    .from('tenders')
    .select('id, title, created_at')
    .ilike('title', '%Адмирал%')
    .order('created_at', { ascending: true });

  console.log(`Найдено тендеров: ${tenders?.length}\n`);

  for (const tender of tenders || []) {
    console.log(`\n=== ${tender.title} (${tender.created_at}) ===`);

    // Найти позиции с "тестовая" или "раздел"
    const { data: positions } = await supabase
      .from('client_positions')
      .select('id, position_number, work_name')
      .eq('tender_id', tender.id)
      .or('work_name.ilike.%тестовая%,work_name.ilike.%раздел 1%');

    console.log(`Позиции (${positions?.length}):`);
    positions?.forEach(p => {
      console.log(`  ${p.position_number}: ${p.work_name}`);
    });

    // Для каждой позиции проверить наличие audit записей
    for (const position of positions || []) {
      const { data: auditRecords, count } = await supabase
        .from('boq_items_audit')
        .select('*', { count: 'exact', head: true })
        .or(`new_data->>client_position_id.eq.${position.id},old_data->>client_position_id.eq.${position.id}`);

      if (count && count > 0) {
        console.log(`    → ${position.position_number} имеет ${count} audit записей`);

        // Загрузить детали
        const { data: records } = await supabase
          .from('boq_items_audit')
          .select('id, operation_type, changed_at, changed_by')
          .or(`new_data->>client_position_id.eq.${position.id},old_data->>client_position_id.eq.${position.id}`)
          .order('changed_at', { ascending: false })
          .limit(10);

        console.log(`      Последние записи:`);
        records?.forEach(r => {
          console.log(`        [${r.operation_type}] ${r.changed_at} | changed_by: ${r.changed_by || 'NULL'}`);
        });
      }
    }
  }
})();
