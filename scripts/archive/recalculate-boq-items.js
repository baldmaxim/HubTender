import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Загружаем переменные из .env.local
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Не удалось загрузить переменные окружения из .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Коэффициенты с учётом material_cost_growth = 10%
const CORRECT_COEFFICIENTS = {
  'мат': 1.640760,      // Материалы с 10% ростом
  'раб': 2.885148,      // Работы
  'суб-мат': 1.403600,  // Субподряд материалы
  'суб-раб': 1.403600   // Субподряд работы
};

async function recalculateBoqItems() {
  console.log('=== ПЕРЕСЧЁТ КОЭФФИЦИЕНТОВ В BOQ_ITEMS ===\n');

  const tenderId = 'cf2d6854-2851-4692-9956-e873b147d789';

  try {
    // 1. Загружаем все BOQ элементы для тендера
    console.log('1️⃣ ЗАГРУЗКА BOQ ЭЛЕМЕНТОВ...\n');

    const { data: boqItems, error } = await supabase
      .from('boq_items')
      .select('*')
      .eq('tender_id', tenderId);

    if (error || !boqItems) {
      console.error('Ошибка загрузки BOQ элементов:', error);
      return;
    }

    console.log(`Найдено элементов: ${boqItems.length}\n`);

    // 2. Группируем по типам
    const byType = {
      'мат': [],
      'раб': [],
      'суб-мат': [],
      'суб-раб': [],
      'мат-комп.': [],
      'раб-комп.': []
    };

    boqItems.forEach(item => {
      if (byType[item.boq_item_type]) {
        byType[item.boq_item_type].push(item);
      }
    });

    console.log('📊 РАСПРЕДЕЛЕНИЕ ПО ТИПАМ:');
    Object.keys(byType).forEach(type => {
      if (byType[type].length > 0) {
        console.log(`  ${type}: ${byType[type].length} элементов`);
      }
    });

    // 3. Пересчитываем коэффициенты для каждого типа
    console.log('\n2️⃣ ПЕРЕСЧЁТ КОЭФФИЦИЕНТОВ:\n');

    let updatedCount = 0;
    let errors = [];

    for (const [itemType, items] of Object.entries(byType)) {
      if (items.length === 0) continue;

      const correctCoeff = CORRECT_COEFFICIENTS[itemType];
      if (!correctCoeff) {
        console.log(`⚠️ Пропускаем тип ${itemType} - нет коэффициента`);
        continue;
      }

      console.log(`\n--- ${itemType.toUpperCase()} ---`);
      console.log(`Правильный коэффициент: ${correctCoeff}`);

      for (const item of items) {
        if (!item.total_amount || item.total_amount === 0) {
          continue;
        }

        // Рассчитываем новую коммерческую стоимость
        const newCommercialCost = item.total_amount * correctCoeff;

        // Определяем, какое поле обновлять
        const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(itemType);
        const updateData = {
          commercial_markup: correctCoeff,
          updated_at: new Date().toISOString()
        };

        if (isMaterial) {
          updateData.total_commercial_material_cost = newCommercialCost;
        } else {
          updateData.total_commercial_work_cost = newCommercialCost;
        }

        // Проверяем, нужно ли обновление
        const currentCommercialCost = isMaterial
          ? item.total_commercial_material_cost
          : item.total_commercial_work_cost;

        const currentCoeff = currentCommercialCost / item.total_amount;

        // Если коэффициент больше 10, это явная ошибка
        if (currentCoeff > 10) {
          console.log(`     ⚠️ Обнаружен завышенный коэффициент: ${currentCoeff.toFixed(2)}`);
        }

        if (Math.abs(currentCoeff - correctCoeff) > 0.001) {
          console.log(`  📝 Обновляем элемент ${item.id.substring(0, 8)}...`);
          console.log(`     Было: ${currentCoeff.toFixed(6)}`);
          console.log(`     Стало: ${correctCoeff.toFixed(6)}`);

          // Обновляем в БД
          const { error: updateError } = await supabase
            .from('boq_items')
            .update(updateData)
            .eq('id', item.id);

          if (updateError) {
            errors.push(`Ошибка обновления ${item.id}: ${updateError.message}`);
          } else {
            updatedCount++;
          }
        }
      }
    }

    // 4. Выводим результаты
    console.log('\n3️⃣ РЕЗУЛЬТАТЫ:\n');
    console.log(`✅ Обновлено элементов: ${updatedCount}`);

    if (errors.length > 0) {
      console.log(`\n❌ Ошибки (${errors.length}):`);
      errors.forEach(err => console.log(`  - ${err}`));
    }

    // 5. Проверяем результат
    console.log('\n4️⃣ ПРОВЕРКА РЕЗУЛЬТАТА:\n');

    const { data: checkItems } = await supabase
      .from('boq_items')
      .select('boq_item_type, total_amount, total_commercial_material_cost, total_commercial_work_cost')
      .eq('tender_id', tenderId)
      .in('boq_item_type', ['мат', 'раб', 'суб-мат', 'суб-раб'])
      .gt('total_amount', 0)
      .limit(10);

    if (checkItems) {
      checkItems.forEach(item => {
        const isMaterial = ['мат', 'суб-мат'].includes(item.boq_item_type);
        const commercialCost = isMaterial
          ? item.total_commercial_material_cost
          : item.total_commercial_work_cost;

        const coeff = commercialCost / item.total_amount;
        const expected = CORRECT_COEFFICIENTS[item.boq_item_type];
        const isCorrect = Math.abs(coeff - expected) < 0.001;

        console.log(`${item.boq_item_type}: ${coeff.toFixed(6)} ${isCorrect ? '✅' : '❌'}`);
      });
    }

    console.log('\n=== ПЕРЕСЧЁТ ЗАВЕРШЁН ===');
    console.log('Теперь обновите страницу Commerce и проверьте коэффициенты.');

  } catch (error) {
    console.error('Критическая ошибка:', error);
  }
}

recalculateBoqItems();