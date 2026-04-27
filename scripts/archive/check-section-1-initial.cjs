const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
  console.log('=== БЫЛ ЛИ РАЗДЕЛ №1 ИЗНАЧАЛЬНО НЕЛИСТОВЫМ? ===\n');

  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', 'ЖК Адмирал')
    .eq('version', 3)
    .single();

  // Получаем первые 3 позиции для анализа
  const { data: positions } = await supabase
    .from('client_positions')
    .select('id, position_number, work_name, hierarchy_level, is_additional, created_at, parent_position_id')
    .eq('tender_id', tender.id)
    .lte('position_number', 2)
    .order('position_number');

  console.log('Первые позиции:\n');
  positions.forEach(p => {
    console.log(`№${p.position_number} (level ${p.hierarchy_level})${p.is_additional ? ' [ДОП]' : ''}`);
    console.log(`  ${p.work_name}`);
    console.log(`  Создана: ${p.created_at}`);
    if (p.parent_position_id) console.log(`  Parent: ${p.parent_position_id}`);
    console.log('');
  });

  const pos1 = positions[0];
  const dop11 = positions.find(p => p.position_number === 1.1 && p.is_additional);

  if (!dop11) {
    console.log('❌ ДОП работы №1.1 НЕТ в базе');
    console.log('\nВОПРОС: Был ли раздел №1 нелистовым БЕЗ ДОП работы?');
    console.log('Для этого нужно проверить следующую позицию после №1...\n');

    // Смотрим, что идёт после позиции №1
    const pos1Index = positions.findIndex(p => p.position_number === 1);
    const nextPos = positions[pos1Index + 1];

    if (nextPos) {
      console.log(`Позиция №1 (level ${pos1.hierarchy_level}) → Следующая: №${nextPos.position_number} (level ${nextPos.hierarchy_level})`);
      const isLeaf = pos1.hierarchy_level >= nextPos.hierarchy_level;
      console.log(`Логика: ${pos1.hierarchy_level} >= ${nextPos.hierarchy_level} = ${isLeaf}`);
      console.log(`\n${isLeaf ? '✅ Раздел №1 был ЛИСТОВЫМ' : '❌ Раздел №1 был НЕЛИСТОВЫМ (раздел)'}`);
    }
  } else {
    console.log('=== ВРЕМЕННАЯ ШКАЛА ===');
    const pos1Created = new Date(pos1.created_at);
    const dopCreated = new Date(dop11.created_at);

    console.log(`1. ${pos1.created_at} - Создан раздел №1`);
    console.log(`2. ${dop11.created_at} - Создана ДОП работа №1.1`);

    if (dopCreated > pos1Created) {
      console.log('\n✅ Раздел №1 был создан БЕЗ ДОП работы');
      console.log('Нужно проверить, был ли он нелистовым ДО добавления ДОП работы');
    }
  }
})();
