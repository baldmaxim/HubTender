const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkHierarchy() {
  const { data, error } = await supabase
    .from('client_positions')
    .select('position_number, work_name, hierarchy')
    .limit(30)
    .order('position_number', { ascending: true });

  if (error) {
    console.error('Ошибка:', error);
    return;
  }

  console.log('Структура поля hierarchy:');
  console.log('position | hierarchy | название');
  console.log('---------|-----------|----------');
  data.forEach(p => {
    const name = p.work_name.length > 50 ? p.work_name.substring(0, 47) + '...' : p.work_name;
    console.log(`${p.position_number.toString().padStart(8)} | ${(p.hierarchy || 'null').toString().padStart(9)} | ${name}`);
  });

  // Подсчет конечных и неконечных
  const leafCount = data.filter(p => p.hierarchy === 'leaf' || p.hierarchy === true).length;
  const nonLeafCount = data.filter(p => p.hierarchy !== 'leaf' && p.hierarchy !== true).length;
  console.log('\nИтого:');
  console.log(`Конечных (leaf): ${leafCount}`);
  console.log(`Неконечных: ${nonLeafCount}`);
}

checkHierarchy();
