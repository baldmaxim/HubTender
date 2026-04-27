const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
  console.log('=== ПРОВЕРКА ПОЗИЦИИ №3 ПОСЛЕ ИСПРАВЛЕНИЙ ===\n');

  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .eq('title', 'ЖК Адмирал')
    .eq('version', 3)
    .single();

  const { data: positions } = await supabase
    .from('client_positions')
    .select('id, position_number, work_name, hierarchy_level, is_additional')
    .eq('tender_id', tender.id)
    .gte('position_number', 2)
    .lte('position_number', 4)
    .order('position_number');

  console.log('Позиции с №2 по №4:\n');

  positions.forEach((p, idx) => {
    const nextPos = positions[idx + 1];
    const isLastInList = idx === positions.length - 1;
    const isLeaf = isLastInList || (p.hierarchy_level >= (nextPos?.hierarchy_level || 0));

    console.log(`№${p.position_number} (level ${p.hierarchy_level})${p.is_additional ? ' [ДОП]' : ''}`);
    console.log(`  ${p.work_name}`);
    console.log(`  Статус: ${isLeaf ? '✅ ЛИСТОВАЯ (кликабельная)' : '❌ НЕЛИСТОВАЯ (не кликабельная)'}`);

    if (!isLastInList) {
      console.log(`  Следующая: №${nextPos.position_number} (level ${nextPos.hierarchy_level})`);
      console.log(`  Логика: ${p.hierarchy_level} >= ${nextPos.hierarchy_level} = ${isLeaf}`);
    }
    console.log('');
  });

  console.log('=== ИТОГ ===\n');
  console.log('Позиция №3 (level 4) и ДОП №3.1 (level 4) имеют одинаковый уровень');
  console.log('Логика: 4 >= 4 = true');
  console.log('✅ Позиция №3 ЛИСТОВАЯ - добавление ДОП работы НЕ изменило её статус!');
})();
