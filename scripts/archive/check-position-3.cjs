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
    .gte('position_number', 2)
    .lte('position_number', 4)
    .order('position_number');

  console.log('=== ПРОВЕРКА ПОЗИЦИЙ ===\n');

  positions.forEach((p, idx) => {
    const nextPos = positions[idx + 1];
    const isLastInList = idx === positions.length - 1;
    const isLeaf = isLastInList || (p.hierarchy_level >= (nextPos?.hierarchy_level || 0));

    console.log(`№${p.position_number} (level ${p.hierarchy_level})${p.is_additional ? ' [ДОП]' : ''}`);
    console.log(`  ${p.work_name}`);
    console.log(`  Листовая: ${isLeaf ? '✅ ДА' : '❌ НЕТ'}`);
    if (!isLastInList) {
      console.log(`  Следующая: №${nextPos.position_number} (level ${nextPos.hierarchy_level})`);
    }
    console.log('');
  });

  const pos3 = positions.find(p => p.position_number === 3);
  if (pos3) {
    const { data: items } = await supabase
      .from('boq_items')
      .select('boq_item_type')
      .eq('client_position_id', pos3.id);

    const works = items?.filter(i => ['раб', 'суб-раб', 'раб-комп.'].includes(i.boq_item_type)).length || 0;
    const materials = items?.filter(i => ['мат', 'суб-мат', 'мат-комп.'].includes(i.boq_item_type)).length || 0;

    console.log('=== ПОЗИЦИЯ №3 ===');
    console.log(`Работ: ${works}`);
    console.log(`Материалов: ${materials}`);
    console.log('Счетчики будут показаны: ✅ ДА (для любой позиции с работами/материалами)');
  }
})();
