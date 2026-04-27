const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const testUserId = 'eafa3aec-d7fa-49e9-9d9d-16650512ea0f';

  console.log('=== Тест RPC wrapper функций ===\n');

  // Найти тендер и позицию
  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .ilike('title', '%Адмирал%')
    .limit(1)
    .single();

  const { data: position } = await supabase
    .from('client_positions')
    .select('id')
    .eq('tender_id', tender.id)
    .ilike('work_name', '%Тестовая%')
    .limit(1)
    .single();

  const { data: workName } = await supabase
    .from('work_names')
    .select('id')
    .limit(1)
    .single();

  console.log('Тендер:', tender.id);
  console.log('Позиция:', position.id);
  console.log('Work name:', workName.id);

  // Тест 1: INSERT через RPC
  console.log('\n1. INSERT через RPC...');
  const { data: insertResult, error: insertError } = await supabase.rpc('insert_boq_item_with_audit', {
    p_user_id: testUserId,
    p_data: {
      tender_id: tender.id,
      client_position_id: position.id,
      boq_item_type: 'раб',
      work_name_id: workName.id,
      quantity: 1,
      unit_code: 'шт',
      total_amount: 100,
      sort_number: 9999,
    },
  });

  if (insertError) {
    console.error('❌ Ошибка INSERT:', insertError);
  } else {
    console.log('✅ Элемент создан:', insertResult.id);

    // Проверить audit
    const { data: auditInsert } = await supabase
      .from('boq_items_audit')
      .select('changed_by')
      .eq('boq_item_id', insertResult.id)
      .eq('operation_type', 'INSERT')
      .single();

    console.log('   changed_by:', auditInsert?.changed_by || 'NULL');

    // Тест 2: UPDATE через RPC
    console.log('\n2. UPDATE через RPC...');
    const { data: updateResult, error: updateError } = await supabase.rpc('update_boq_item_with_audit', {
      p_user_id: testUserId,
      p_item_id: insertResult.id,
      p_data: {
        quantity: 2,
        total_amount: 200,
      },
    });

    if (updateError) {
      console.error('❌ Ошибка UPDATE:', updateError);
    } else {
      console.log('✅ Элемент обновлен');

      // Проверить audit
      const { data: auditUpdate } = await supabase
        .from('boq_items_audit')
        .select('changed_by')
        .eq('boq_item_id', insertResult.id)
        .eq('operation_type', 'UPDATE')
        .order('changed_at', { ascending: false })
        .limit(1)
        .single();

      console.log('   changed_by:', auditUpdate?.changed_by || 'NULL');
    }

    // Тест 3: DELETE через RPC
    console.log('\n3. DELETE через RPC...');
    const { data: deleteResult, error: deleteError } = await supabase.rpc('delete_boq_item_with_audit', {
      p_user_id: testUserId,
      p_item_id: insertResult.id,
    });

    if (deleteError) {
      console.error('❌ Ошибка DELETE:', deleteError);
    } else {
      console.log('✅ Элемент удален');

      // Проверить audit
      const { data: auditDelete } = await supabase
        .from('boq_items_audit')
        .select('changed_by')
        .eq('boq_item_id', insertResult.id)
        .eq('operation_type', 'DELETE')
        .single();

      console.log('   changed_by:', auditDelete?.changed_by || 'NULL');
    }
  }
})();
