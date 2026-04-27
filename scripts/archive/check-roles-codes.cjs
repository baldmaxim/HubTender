// Детальная проверка содержимого roles.code
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function checkRolesCodes() {
  console.log('🔍 Детальная проверка roles.code...\n');

  const { data: roles, error } = await supabase
    .from('roles')
    .select('*')
    .order('name');

  if (error) {
    console.error('❌ Ошибка:', error.message);
    return;
  }

  console.log('📋 Полные данные из таблицы roles:\n');
  console.log(JSON.stringify(roles, null, 2));

  console.log('\n📊 Таблица roles (структура):');
  console.log('code | name | allowed_pages | is_system_role');
  console.log('-'.repeat(80));
  roles.forEach(role => {
    const code = role.code || 'NULL';
    const name = role.name || 'NULL';
    const pages = Array.isArray(role.allowed_pages) ? role.allowed_pages.length : 'NULL';
    const isSystem = role.is_system_role ? 'YES' : 'NO';
    console.log(`${code.padEnd(12)} | ${name.padEnd(20)} | ${String(pages).padEnd(3)} pages | ${isSystem}`);
  });
}

checkRolesCodes();
