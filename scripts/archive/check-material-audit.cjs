// Проверить audit_log для материалов
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkMaterialAudit() {
  const materialIds = [
    '308fb0c9-2ed5-4aba-92e8-eb23cce13fab', // ЕАЕ KXА
    '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c', // ЕАЕ KX
  ];

  for (const id of materialIds) {
    const { data: item } = await supabase
      .from('boq_items')
      .select('material_names (name), created_at, updated_at, total_amount')
      .eq('id', id)
      .single();

    console.log(`\n\n=== ${item.material_names.name} ===`);
    console.log('Создан:', item.created_at);
    console.log('Обновлён:', item.updated_at);
    console.log('Текущая total_amount:', item.total_amount);

    // Проверить все записи в audit_log для этого материала
    const { data: auditLogs } = await supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'boq_items')
      .eq('record_id', id)
      .order('created_at', { ascending: true });

    if (auditLogs && auditLogs.length > 0) {
      console.log(`\nИстория изменений (${auditLogs.length} записей):`);
      auditLogs.forEach((log, idx) => {
        console.log(`\n${idx + 1}. ${log.action} - ${log.created_at}`);
        console.log('   User:', log.user_id);

        if (log.new_value) {
          try {
            const newVal = JSON.parse(log.new_value);
            if (log.action === 'INSERT') {
              console.log('   Создан с параметрами:');
              console.log('     unit_rate:', newVal.unit_rate);
              console.log('     currency_type:', newVal.currency_type);
              console.log('     delivery_price_type:', newVal.delivery_price_type);
              console.log('     delivery_amount:', newVal.delivery_amount);
              console.log('     total_amount:', newVal.total_amount);
            } else if (log.action === 'UPDATE') {
              if (newVal.total_amount !== undefined) {
                console.log('   Изменена total_amount:', newVal.total_amount);
              }
            }
          } catch (e) {
            console.log('   Не удалось распарсить new_value');
          }
        }

        if (log.old_value && log.action === 'UPDATE') {
          try {
            const oldVal = JSON.parse(log.old_value);
            if (oldVal.total_amount !== undefined) {
              console.log('   Старая total_amount:', oldVal.total_amount);
            }
          } catch (e) {}
        }
      });
    } else {
      console.log('\n⚠️  Нет записей в audit_log для этого материала');
    }
  }

  // Также проверим историю изменений курса USD в тендере
  console.log('\n\n=== ИСТОРИЯ КУРСА USD В ТЕНДЕРЕ ===');

  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, version, usd_rate, created_at, updated_at')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log('Тендер:', tender.title);
  console.log('Версия:', tender.version);
  console.log('Создан:', tender.created_at);
  console.log('Обновлён:', tender.updated_at);
  console.log('Текущий курс USD:', tender.usd_rate);

  const { data: tenderAudit } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', 'tenders')
    .eq('record_id', tender.id)
    .order('created_at', { ascending: true });

  if (tenderAudit && tenderAudit.length > 0) {
    console.log(`\nИстория изменений тендера (${tenderAudit.length} записей):`);
    tenderAudit.forEach((log, idx) => {
      console.log(`\n${idx + 1}. ${log.action} - ${log.created_at}`);

      if (log.new_value) {
        try {
          const newVal = JSON.parse(log.new_value);
          if (newVal.usd_rate !== undefined) {
            console.log('   Новый курс USD:', newVal.usd_rate);
          }
        } catch (e) {}
      }

      if (log.old_value) {
        try {
          const oldVal = JSON.parse(log.old_value);
          if (oldVal.usd_rate !== undefined) {
            console.log('   Старый курс USD:', oldVal.usd_rate);
          }
        } catch (e) {}
      }
    });
  } else {
    console.log('\n⚠️  Нет записей в audit_log для тендера');
    console.log('Возможные причины:');
    console.log('1. Audit logging не был включен при создании тендера');
    console.log('2. Курс USD всегда был 80.85');
    console.log('3. Материалы были импортированы из Excel с предрасчитанными значениями');
  }
}

checkMaterialAudit();
