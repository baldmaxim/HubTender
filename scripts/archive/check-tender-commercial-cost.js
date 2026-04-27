/**
 * Проверка коммерческой стоимости тендера
 * Отладочный скрипт для проверки данных в БД
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function checkTenderCommercialCost() {
  console.log('🔍 Проверка коммерческой стоимости тендеров\n');

  // 1. Получаем все тендеры
  const { data: tenders, error: tendersError } = await supabase
    .from('tenders')
    .select('id, title, tender_number')
    .order('created_at', { ascending: false })
    .limit(5);

  if (tendersError) {
    console.error('❌ Ошибка загрузки тендеров:', tendersError);
    return;
  }

  console.log(`📋 Найдено тендеров: ${tenders?.length || 0}\n`);

  for (const tender of tenders || []) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📦 Тендер: ${tender.title} (${tender.tender_number})`);
    console.log(`   ID: ${tender.id}`);
    console.log(`${'='.repeat(80)}\n`);

    // 2. Получаем позиции для тендера
    const { data: positions, error: posError } = await supabase
      .from('client_positions')
      .select('id, work_name, position_number')
      .eq('tender_id', tender.id);

    if (posError) {
      console.error('   ❌ Ошибка загрузки позиций:', posError);
      continue;
    }

    console.log(`   📝 Позиций заказчика: ${positions?.length || 0}`);

    if (!positions || positions.length === 0) {
      console.log('   ⚠️  У тендера нет позиций заказчика');
      continue;
    }

    // 3. Получаем BOQ items напрямую через tender_id
    const { data: boqItems, error: itemsError } = await supabase
      .from('boq_items')
      .select('client_position_id, total_commercial_material_cost, total_commercial_work_cost')
      .eq('tender_id', tender.id);

    if (itemsError) {
      console.error('   ❌ Ошибка загрузки BOQ items:', itemsError);
      continue;
    }

    console.log(`   📊 BOQ items: ${boqItems?.length || 0}\n`);

    if (!boqItems || boqItems.length === 0) {
      console.log('   ⚠️  У позиций нет BOQ items (работ и материалов)');
      continue;
    }

    // 4. Считаем общую коммерческую стоимость
    let totalCommercialCost = 0;
    let itemsWithData = 0;
    let itemsWithoutData = 0;

    for (const item of boqItems) {
      const materialCost = item.total_commercial_material_cost || 0;
      const workCost = item.total_commercial_work_cost || 0;
      const itemTotal = materialCost + workCost;

      totalCommercialCost += itemTotal;

      if (itemTotal > 0) {
        itemsWithData++;
      } else {
        itemsWithoutData++;
      }
    }

    console.log(`   💰 Итоговая коммерческая стоимость: ${totalCommercialCost.toFixed(2)} руб.`);
    console.log(`   ✅ Items с данными: ${itemsWithData}`);
    console.log(`   ⚠️  Items без данных (0): ${itemsWithoutData}`);

    // 5. Показываем примеры данных
    if (itemsWithData > 0) {
      console.log('\n   📋 Примеры BOQ items с данными:');
      const itemsWithCost = boqItems.filter(item =>
        (item.total_commercial_material_cost || 0) + (item.total_commercial_work_cost || 0) > 0
      ).slice(0, 3);

      for (const item of itemsWithCost) {
        const materialCost = item.total_commercial_material_cost || 0;
        const workCost = item.total_commercial_work_cost || 0;
        console.log(`      - Материалы: ${materialCost.toFixed(2)}, Работы: ${workCost.toFixed(2)}`);
      }
    }

    if (itemsWithoutData > 0) {
      console.log(`\n   ⚠️  ${itemsWithoutData} BOQ items имеют нулевую стоимость`);
      console.log('      Возможные причины:');
      console.log('      1. Не применена тактика наценок');
      console.log('      2. Не запущен пересчет коммерческих цен');
      console.log('      3. Базовые цены равны нулю');
    }
  }

  console.log('\n✅ Проверка завершена');
}

checkTenderCommercialCost().catch(console.error);
