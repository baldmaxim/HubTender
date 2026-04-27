// Проверить историю изменений курса в тендере
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkHistory() {
  // Получить тендер
  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, version, usd_rate, created_at, updated_at')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log('=== ТЕНДЕР ===');
  console.log('ID:', tender.id);
  console.log('Название:', tender.title);
  console.log('Версия:', tender.version);
  console.log('Текущий курс USD:', tender.usd_rate);
  console.log('Создан:', tender.created_at);
  console.log('Обновлён:', tender.updated_at);

  // Проверить audit_log для тендера
  const { data: auditLogs } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', 'tenders')
    .eq('record_id', tender.id)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n=== ИСТОРИЯ ИЗМЕНЕНИЙ ТЕНДЕРА (audit_log) ===');
  if (auditLogs && auditLogs.length > 0) {
    auditLogs.forEach((log, idx) => {
      console.log(`\n${idx + 1}. ${log.action} - ${log.created_at}`);

      if (log.old_value) {
        try {
          const oldVal = JSON.parse(log.old_value);
          if (oldVal.usd_rate) {
            console.log('  Старый курс USD:', oldVal.usd_rate);
          }
        } catch (e) {}
      }

      if (log.new_value) {
        try {
          const newVal = JSON.parse(log.new_value);
          if (newVal.usd_rate) {
            console.log('  Новый курс USD:', newVal.usd_rate);
          }
        } catch (e) {}
      }
    });
  } else {
    console.log('Нет записей в audit_log для этого тендера');
  }

  // Проверить когда были созданы проблемные материалы
  const materialIds = [
    '308fb0c9-2ed5-4aba-92e8-eb23cce13fab',
    '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c',
  ];

  console.log('\n\n=== ПРОБЛЕМНЫЕ МАТЕРИАЛЫ ===');
  for (const id of materialIds) {
    const { data: item } = await supabase
      .from('boq_items')
      .select('id, material_names(name), created_at, updated_at, total_amount')
      .eq('id', id)
      .single();

    console.log(`\n${item.material_names.name}`);
    console.log('  Создан:', item.created_at);
    console.log('  Обновлён:', item.updated_at);
    console.log('  Total amount:', item.total_amount);

    // Проверить audit_log для материала
    const { data: itemAudit } = await supabase
      .from('audit_log')
      .select('action, created_at, old_value, new_value')
      .eq('table_name', 'boq_items')
      .eq('record_id', id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (itemAudit && itemAudit.length > 0) {
      console.log('  История изменений:');
      itemAudit.forEach((log, idx) => {
        console.log(`    ${idx + 1}. ${log.action} - ${log.created_at}`);

        if (log.new_value) {
          try {
            const newVal = JSON.parse(log.new_value);
            if (newVal.total_amount) {
              console.log(`       total_amount: ${newVal.total_amount}`);
            }
          } catch (e) {}
        }
      });
    }
  }

  // Проверить курс на момент создания материалов
  console.log('\n\n=== АНАЛИЗ ===');
  const materialCreatedAt = '2024-12-xx'; // Заполнится из результата выше
  console.log('Возможные причины:');
  console.log('1. Курс в тендере был изменён после создания материалов');
  console.log('2. Материалы были импортированы из Excel с готовой суммой');
  console.log('3. При сохранении использовался неправильный курс из другого источника');
}

checkHistory();
