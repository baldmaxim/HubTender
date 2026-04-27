const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TENDER_ID = 'b307b7d5-b145-4d06-a92e-8d1d50a6befe';

async function triggerRecalc() {
  console.log('🔄 Триггер пересчета для тендера ЖК Событие 6.2...\n');

  // Обновляем тендер, чтобы триггерить пересчет
  const { data, error } = await supabase
    .from('tenders')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', TENDER_ID)
    .select()
    .single();

  if (error) {
    console.error('Ошибка:', error);
    return;
  }

  console.log('✅ Тендер обновлен:', data.name);
  console.log('\nТеперь нужно:');
  console.log('1. Открыть страницу /admin/markup_constructor');
  console.log('2. Выбрать тендер "ЖК Событие 6.2"');
  console.log('3. Нажать кнопку "Пересчитать"');
  console.log('\nИли используйте API endpoint для пересчета.');
}

triggerRecalc().catch(console.error);
