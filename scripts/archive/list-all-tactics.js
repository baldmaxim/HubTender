import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем .env.local
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function listAllTactics() {
  console.log('\n📋 ВСЕ СХЕМЫ НАЦЕНОК В БАЗЕ\n');
  console.log('═══════════════════════════════════════════\n');

  // Получаем все тактики
  const { data: tactics } = await supabase
    .from('markup_tactics')
    .select('*')
    .order('created_at', { ascending: false });

  if (!tactics || tactics.length === 0) {
    console.log('⚠️  Схемы наценок не найдены');
    return;
  }

  console.log(`Всего схем: ${tactics.length}\n`);

  for (const tactic of tactics) {
    console.log(`📌 ${tactic.name}`);
    console.log(`   ID: ${tactic.id}`);
    console.log(`   Глобальная: ${tactic.is_global ? 'Да' : 'Нет'}`);

    // Получаем параметры для этой тактики
    const { data: parameters } = await supabase
      .from('markup_parameters')
      .select('*')
      .eq('markup_tactic_id', tactic.id)
      .order('order_number', { ascending: true });

    if (parameters && parameters.length > 0) {
      console.log(`   Параметров: ${parameters.length}`);
      console.log('   Параметры:');
      parameters.forEach((param, idx) => {
        console.log(`     ${idx + 1}. ${param.parameter_name} (База: ${param.base_value}, Коэф: ${param.coefficient})`);
      });
    } else {
      console.log('   ⚠️  Параметры отсутствуют');
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════════\n');
}

listAllTactics();
