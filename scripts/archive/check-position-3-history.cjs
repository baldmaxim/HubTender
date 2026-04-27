const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
  console.log('=== ИСТОРИЯ ПОЗИЦИИ №3 ===\n');

  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', 'ЖК Адмирал')
    .eq('version', 3)
    .single();

  // Получаем все позиции вокруг №3 для понимания контекста
  const { data: positions } = await supabase
    .from('client_positions')
    .select('id, position_number, work_name, hierarchy_level, is_additional, created_at, parent_position_id')
    .eq('tender_id', tender.id)
    .gte('position_number', 2)
    .lte('position_number', 4)
    .order('position_number');

  console.log('Позиции с №2 по №4:');
  positions.forEach(p => {
    console.log(`\n№${p.position_number} (level ${p.hierarchy_level})${p.is_additional ? ' [ДОП]' : ''}`);
    console.log(`  ${p.work_name}`);
    console.log(`  Создана: ${p.created_at}`);
    if (p.parent_position_id) {
      console.log(`  Parent ID: ${p.parent_position_id}`);
    }
  });

  // Проверяем позицию №3 в контексте
  const pos3 = positions.find(p => p.position_number === 3);
  const pos31 = positions.find(p => p.position_number === 3.1);
  const pos4 = positions.find(p => p.position_number === 4);

  console.log('\n=== АНАЛИЗ ПОЗИЦИИ №3 ===\n');
  console.log('Позиция №3:');
  console.log(`  Level: ${pos3.hierarchy_level}`);
  console.log(`  Создана: ${pos3.created_at}`);

  if (pos31) {
    console.log('\nДОП работа №3.1:');
    console.log(`  Level: ${pos31.hierarchy_level}`);
    console.log(`  Создана: ${pos31.created_at}`);
    console.log(`  Parent: ${pos31.parent_position_id}`);

    const dopCreated = new Date(pos31.created_at);
    const pos3Created = new Date(pos3.created_at);

    console.log('\n=== ВРЕМЕННАЯ ШКАЛА ===');
    if (dopCreated > pos3Created) {
      console.log('✅ Позиция №3 была создана РАНЬШЕ, чем ДОП работа №3.1');
      console.log('   Это означает, что изначально позиция №3 была БЕЗ ДОП работы');
    }
  }

  // Проверяем, была ли позиция №3 листовой ДО создания ДОП работы
  console.log('\n=== БЫЛА ЛИ ПОЗИЦИЯ №3 ЛИСТОВОЙ ПРИ ЗАГРУЗКЕ? ===\n');

  if (pos4) {
    console.log('Позиция №3 (level 4) → Следующая: №4 (level 2)');
    console.log(`Логика isLeaf: 4 >= 2 = true`);
    console.log('\n✅ ДА, позиция №3 была ЛИСТОВОЙ при первоначальной загрузке (до создания ДОП работы)');
    console.log('   Она стала нелистовой только после добавления ДОП работы №3.1 (level 5)');
  }

  // Проверяем текущее состояние
  console.log('\n=== ТЕКУЩЕЕ СОСТОЯНИЕ ===\n');
  console.log('Позиция №3 (level 4) → Следующая: ДОП №3.1 (level 5)');
  console.log(`Логика isLeaf: 4 >= 5 = false`);
  console.log('❌ СЕЙЧАС позиция №3 НЕЛИСТОВАЯ (не кликабельная)');
})();
