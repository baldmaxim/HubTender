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

async function listTenders() {
  console.log('\n📋 СПИСОК ТЕНДЕРОВ В БАЗЕ ДАННЫХ\n');
  console.log('═══════════════════════════════════════════\n');

  const { data: tenders, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Ошибка при получении тендеров:', error);
    return;
  }

  if (!tenders || tenders.length === 0) {
    console.log('⚠️  Тендеры не найдены в базе данных');
    return;
  }

  console.log(`Всего тендеров: ${tenders.length}\n`);

  tenders.forEach((tender, idx) => {
    console.log(`${idx + 1}. ${tender.title}`);
    console.log(`   Номер: ${tender.tender_number || 'не указан'}`);
    console.log(`   ID: ${tender.id}`);
    console.log(`   Создан: ${new Date(tender.created_at).toLocaleDateString('ru-RU')}`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════\n');
}

listTenders();
