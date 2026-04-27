import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Чтение .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envLines = envContent.split('\n');

let supabaseUrl = '';
let supabaseKey = '';

envLines.forEach(line => {
  const [key, value] = line.split('=');
  if (key === 'VITE_SUPABASE_URL') {
    supabaseUrl = value.trim();
  } else if (key === 'VITE_SUPABASE_ANON_KEY') {
    supabaseKey = value.trim();
  }
});

const supabase = createClient(supabaseUrl, supabaseKey);

async function showTacticDetails() {
  console.log('=== ДЕТАЛЬНАЯ СТРУКТУРА БАЗОВОЙ СХЕМЫ ===\n');

  try {
    // Получаем глобальную тактику
    const { data: tactic } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('is_global', true)
      .single();

    if (!tactic) {
      console.log('Глобальная тактика не найдена');
      return;
    }

    // Парсим последовательности
    const sequences = typeof tactic.sequences === 'string'
      ? JSON.parse(tactic.sequences)
      : tactic.sequences;

    // Выводим JSON для каждого типа
    const types = ['мат', 'раб', 'суб-мат', 'суб-раб', 'мат-комп.', 'раб-комп.'];

    for (const type of types) {
      console.log(`\n=== ${type.toUpperCase()} ===`);
      const sequence = sequences[type];

      if (sequence && sequence.length > 0) {
        console.log(JSON.stringify(sequence, null, 2));
      } else {
        console.log('Пустая последовательность');
      }
    }

    // Также сохраним в файл для анализа
    const outputPath = path.join(__dirname, 'base-tactic-structure.json');
    fs.writeFileSync(outputPath, JSON.stringify(sequences, null, 2));
    console.log(`\n✅ Структура сохранена в: ${outputPath}`);

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

showTacticDetails();