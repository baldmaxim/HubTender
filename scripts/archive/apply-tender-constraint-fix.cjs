/**
 * Применить исправление уникального ограничения для таблицы tenders
 * Изменяет UNIQUE (tender_number) на UNIQUE (tender_number, version)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Ошибка: не найдены переменные окружения VITE_SUPABASE_URL или VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyFix() {
  console.log('🔧 Применение исправления уникального ограничения...\n');

  try {
    // Читаем SQL файл
    const sqlPath = path.join(__dirname, 'fix-tender-unique-constraint.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('📄 SQL для выполнения:');
    console.log(sql);
    console.log('\n');

    // Выполняем SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      console.error('❌ Ошибка выполнения SQL:', error.message);

      console.log('\n⚠️  Возможно, у вас нет прав для выполнения DDL через RPC.');
      console.log('Пожалуйста, выполните следующие команды вручную в Supabase Dashboard > SQL Editor:\n');
      console.log(sql);

      process.exit(1);
    }

    console.log('✅ Исправление успешно применено!');
    console.log('Теперь можно создавать несколько версий тендера с одним tender_number');

  } catch (err) {
    console.error('❌ Неожиданная ошибка:', err.message);

    console.log('\n⚠️  Выполните SQL вручную в Supabase Dashboard > SQL Editor:');
    const sqlPath = path.join(__dirname, 'fix-tender-unique-constraint.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    console.log(sql);

    process.exit(1);
  }
}

applyFix();
