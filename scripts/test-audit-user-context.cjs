const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const testUserId = 'eafa3aec-d7fa-49e9-9d9d-16650512ea0f';

  console.log('=== Тест RPC функций ===\n');

  // Шаг 1: Установить user_id
  console.log('1. Устанавливаем user_id через RPC...');
  const { data: setData, error: setError } = await supabase.rpc('set_audit_user', {
    user_id: testUserId,
  });

  if (setError) {
    console.error('❌ Ошибка set_audit_user:', setError);
  } else {
    console.log('✅ set_audit_user выполнен');
  }

  // Шаг 2: Создать тестовую запись, чтобы проверить, записывается ли user_id
  console.log('\n2. Создаем тестовую позицию для проверки...');

  // Найти тендер Адмирал
  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .ilike('title', '%Адмирал%')
    .limit(1)
    .single();

  if (!tender) {
    console.log('Тендер не найден');
    return;
  }

  console.log('Тендер найден:', tender.id);

  // Шаг 3: Найти тестовую позицию
  const { data: position } = await supabase
    .from('client_positions')
    .select('id')
    .eq('tender_id', tender.id)
    .ilike('work_name', '%Тестовая%')
    .limit(1)
    .single();

  if (!position) {
    console.log('Тестовая позиция не найдена');
    return;
  }

  console.log('Позиция найдена:', position.id);

  // Получить любой work_name_id
  const { data: workName } = await supabase
    .from('work_names')
    .select('id')
    .limit(1)
    .single();

  if (!workName) {
    console.log('Work name не найден');
    return;
  }

  // Шаг 4: Создать тестовый элемент БЕЗ executeWithAudit
  console.log('\n3. Создаем элемент БЕЗ executeWithAudit (должен быть changed_by = NULL)...');

  const { data: insertData1, error: insertError1 } = await supabase
    .from('boq_items')
    .insert({
      tender_id: tender.id,
      client_position_id: position.id,
      boq_item_type: 'раб',
      work_name_id: workName.id,
      quantity: 1,
      unit_code: 'шт',
      total_amount: 100,
      sort_number: 9999,
    })
    .select('id')
    .single();

  if (insertError1) {
    console.error('❌ Ошибка insert:', insertError1);
  } else {
    console.log('✅ Элемент создан:', insertData1.id);

    // Проверить audit запись
    const { data: audit1 } = await supabase
      .from('boq_items_audit')
      .select('changed_by')
      .eq('boq_item_id', insertData1.id)
      .eq('operation_type', 'INSERT')
      .single();

    console.log('   changed_by:', audit1?.changed_by || 'NULL');
  }

  // Шаг 5: Создать элемент С executeWithAudit (вручную вызвав RPC)
  console.log('\n4. Создаем элемент С set_audit_user (должен быть changed_by = user_id)...');

  // Установить user_id
  await supabase.rpc('set_audit_user', { user_id: testUserId });

  const { data: insertData2, error: insertError2 } = await supabase
    .from('boq_items')
    .insert({
      tender_id: tender.id,
      client_position_id: position.id,
      boq_item_type: 'раб',
      work_name_id: workName.id,
      quantity: 1,
      unit_code: 'шт',
      total_amount: 200,
      sort_number: 9998,
    })
    .select('id')
    .single();

  if (insertError2) {
    console.error('❌ Ошибка insert:', insertError2);
  } else {
    console.log('✅ Элемент создан:', insertData2.id);

    // Проверить audit запись
    const { data: audit2 } = await supabase
      .from('boq_items_audit')
      .select('changed_by')
      .eq('boq_item_id', insertData2.id)
      .eq('operation_type', 'INSERT')
      .single();

    console.log('   changed_by:', audit2?.changed_by || 'NULL');
  }

  // Очистить
  await supabase.rpc('clear_audit_user');

  // Шаг 6: Удалить тестовые элементы
  console.log('\n5. Удаляем тестовые элементы...');
  if (insertData1?.id) {
    await supabase.from('boq_items').delete().eq('id', insertData1.id);
  }
  if (insertData2?.id) {
    await supabase.from('boq_items').delete().eq('id', insertData2.id);
  }
  console.log('✅ Тестовые элементы удалены');
})();
