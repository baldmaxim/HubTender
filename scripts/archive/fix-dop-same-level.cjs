const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
  console.log('=== ИСПРАВЛЕНИЕ: ДОП РАБОТЫ НЕ МЕНЯЮТ СТАТУС РОДИТЕЛЯ ===\n');

  // Находим все ДОП работы
  const { data: dopWorks } = await supabase
    .from('client_positions')
    .select('id, position_number, work_name, hierarchy_level, parent_position_id')
    .eq('is_additional', true)
    .not('parent_position_id', 'is', null);

  console.log(`Найдено ДОП работ: ${dopWorks.length}\n`);

  let fixed = 0;

  for (const dop of dopWorks) {
    // Получаем родительскую позицию
    const { data: parent } = await supabase
      .from('client_positions')
      .select('hierarchy_level, position_number, work_name')
      .eq('id', dop.parent_position_id)
      .single();

    if (!parent) continue;

    // ДОП работа должна иметь ТОТ ЖЕ уровень, что и родитель
    const correctLevel = parent.hierarchy_level;

    if (dop.hierarchy_level !== correctLevel) {
      console.log(`ДОП №${dop.position_number}: ${dop.work_name}`);
      console.log(`  Parent: №${parent.position_number} "${parent.work_name}" (level ${parent.hierarchy_level})`);
      console.log(`  Исправляем: level ${dop.hierarchy_level} → ${correctLevel}`);

      const { error } = await supabase
        .from('client_positions')
        .update({ hierarchy_level: correctLevel })
        .eq('id', dop.id);

      if (error) {
        console.error(`  ❌ Ошибка: ${error.message}`);
      } else {
        console.log('  ✅ Исправлено');
        fixed++;
      }
      console.log('');
    }
  }

  console.log(`\n=== ИТОГО ИСПРАВЛЕНО: ${fixed} ДОП работ ===`);
  console.log('\nТеперь ДОП работы имеют тот же hierarchy_level, что и родители,');
  console.log('и НЕ влияют на статус родительской позиции (листовая/нелистовая)');
})();
