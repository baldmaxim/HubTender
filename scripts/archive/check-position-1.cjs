const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
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
    .lte('position_number', 2)
    .order('position_number');

  console.log('=== ПРОВЕРКА РАЗДЕЛА (СТРОКА №1) ===\n');

  for (let idx = 0; idx < positions.length; idx++) {
    const p = positions[idx];
    const nextPos = positions[idx + 1];
    const isLastInList = idx === positions.length - 1;
    const isLeaf = isLastInList || (p.hierarchy_level >= (nextPos?.hierarchy_level || 0));

    console.log(`№${p.position_number} (level ${p.hierarchy_level})${p.is_additional ? ' [ДОП]' : ''}`);
    console.log(`  ${p.work_name}`);
    console.log(`  Статус: ${isLeaf ? '✅ ЛИСТОВАЯ (кликабельная)' : '❌ НЕЛИСТОВАЯ (раздел, не кликабельная)'}`);

    if (!isLastInList) {
      console.log(`  Следующая: №${nextPos.position_number} (level ${nextPos.hierarchy_level})`);
      console.log(`  Логика: ${p.hierarchy_level} >= ${nextPos.hierarchy_level} = ${isLeaf}`);
    }

    // Проверяем наличие работ/материалов
    const { data: items } = await supabase
      .from('boq_items')
      .select('boq_item_type')
      .eq('client_position_id', p.id);

    const works = items?.filter(i => ['раб', 'суб-раб', 'раб-комп.'].includes(i.boq_item_type)).length || 0;
    const materials = items?.filter(i => ['мат', 'суб-мат', 'мат-комп.'].includes(i.boq_item_type)).length || 0;

    console.log(`  Работ: ${works}, Материалов: ${materials}`);

    if (works > 0 || materials > 0) {
      console.log(`  ⚠️ ВНИМАНИЕ: В ${isLeaf ? 'листовой' : 'нелистовой'} позиции есть работы/материалы!`);
      console.log(`  Счетчики будут показаны в UI: ✅ ДА`);
    } else {
      console.log(`  Работы/материалы отсутствуют`);
    }

    console.log('');
  }
})();
