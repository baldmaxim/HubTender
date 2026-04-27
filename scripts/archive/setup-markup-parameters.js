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

// Определяем все параметры с их ID из tender_markup_percentage
const PARAMETER_DEFINITIONS = {
  '2c487a7b-bfb2-4315-84e2-47204ef1b4d8': { key: 'mechanization_service', name: 'Механизация и услуги', default: 5 },
  '69bb3c39-68b6-4738-b1ad-855b06ef65b6': { key: 'mbp_gsm', name: 'МБП и ГСМ', default: 5 },
  '4c7f6c87-5603-49de-ab14-a41e4cc1576d': { key: 'warranty_period', name: 'Гарантийный период', default: 5 },
  '8025d9c4-7702-4f3a-a496-1eca820345e6': { key: 'works_16_markup', name: 'Наценка на работы 16%', default: 60 },
  'be99baf4-2afe-4387-8591-decb50cc44e4': { key: 'works_cost_growth', name: 'Рост стоимости работ', default: 10 },
  '78b4763a-1b67-4079-a0ec-fe40c8a05e00': { key: 'material_cost_growth', name: 'Рост стоимости материалов', default: 10 },
  '4961e7f2-4abc-4d3c-8213-6f49424387f8': { key: 'subcontract_works_cost_growth', name: 'Рост стоимости работ субподряда', default: 10 },
  '214d9304-a070-4a82-a302-1d880efa7fdd': { key: 'subcontract_materials_cost_growth', name: 'Рост стоимости материалов субподряда', default: 10 },
  '4952629e-3026-47f3-a7de-1f0166de75d4': { key: 'contingency_costs', name: 'Непредвиденные расходы', default: 3 },
  '227c4abd-e3bd-471c-95ea-d0c1d0100506': { key: 'overhead_own_forces', name: 'Накладные расходы (собственные силы)', default: 10 },
  'e322a83d-ad51-45d9-b809-b56904971f40': { key: 'overhead_subcontract', name: 'Накладные расходы (субподряд)', default: 10 },
  'd40f22a5-119c-47ed-817d-ce58603b398d': { key: 'general_costs_without_subcontract', name: 'Общие расходы без субподряда', default: 20 },
  '369e3c15-a03e-475c-bdd4-a91a0b70a4e9': { key: 'profit_own_forces', name: 'Прибыль (собственные силы)', default: 10 },
  '46be3bc8-80a9-4eda-b8b2-a1f8a550bbfc': { key: 'profit_subcontract', name: 'Прибыль (субподряд)', default: 16 }
};

async function setupMarkupParameters() {
  console.log('=== НАСТРОЙКА ПАРАМЕТРОВ НАЦЕНОК ===\n');

  const tenderId = 'cf2d6854-2851-4692-9956-e873b147d789';

  try {
    // 1. Создаём или обновляем markup_parameter_types
    console.log('1️⃣ СОЗДАНИЕ ТИПОВ ПАРАМЕТРОВ В markup_parameter_types:\n');

    for (const [id, definition] of Object.entries(PARAMETER_DEFINITIONS)) {
      // Проверяем, существует ли уже
      const { data: existing } = await supabase
        .from('markup_parameter_types')
        .select('*')
        .eq('id', id)
        .single();

      if (!existing) {
        const { error } = await supabase
          .from('markup_parameter_types')
          .insert({
            id: id,
            parameter_key: definition.key,
            name: definition.name,
            description: definition.name,
            is_active: true,
            default_value: definition.default,
            order_num: 1
          });

        if (error) {
          console.error(`❌ Ошибка создания ${definition.key}:`, error.message);
        } else {
          console.log(`✅ Создан тип: ${definition.key}`);
        }
      } else {
        console.log(`⏩ Уже существует: ${definition.key}`);
      }
    }

    // 2. Проверяем текущие значения в tender_markup_percentage
    console.log('\n2️⃣ ТЕКУЩИЕ ЗНАЧЕНИЯ В tender_markup_percentage:\n');

    const { data: currentValues } = await supabase
      .from('tender_markup_percentage')
      .select('*')
      .eq('tender_id', tenderId);

    if (currentValues) {
      currentValues.forEach(val => {
        const def = PARAMETER_DEFINITIONS[val.markup_parameter_id];
        if (def) {
          console.log(`${def.key}: ${val.value}%`);
          if (def.key === 'material_cost_growth') {
            console.log(`  👆 Это параметр material_cost_growth = ${val.value}%`);
          }
        }
      });
    }

    // 3. Проверяем, есть ли material_cost_growth
    const materialGrowthId = '78b4763a-1b67-4079-a0ec-fe40c8a05e00';
    const hasMatGrowth = currentValues?.some(v => v.markup_parameter_id === materialGrowthId);

    if (!hasMatGrowth) {
      console.log('\n⚠️ material_cost_growth НЕ НАЙДЕН в tender_markup_percentage!');
      console.log('Добавляем со значением 10%...');

      const { error } = await supabase
        .from('tender_markup_percentage')
        .insert({
          tender_id: tenderId,
          markup_parameter_id: materialGrowthId,
          value: 10
        });

      if (error) {
        console.error('❌ Ошибка добавления:', error.message);
      } else {
        console.log('✅ material_cost_growth добавлен = 10%');
      }
    } else {
      console.log('\n✅ material_cost_growth уже есть в таблице');
    }

    // 4. Теперь исправим функцию loadMarkupParameters, чтобы она правильно загружала данные
    console.log('\n3️⃣ ИСПРАВЛЕНИЕ ЗАГРУЗКИ ПАРАМЕТРОВ:\n');
    console.log('Теперь нужно исправить loadMarkupParameters в markupTacticService.ts');
    console.log('Чтобы она правильно обрабатывала данные из tender_markup_percentage');

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

setupMarkupParameters();