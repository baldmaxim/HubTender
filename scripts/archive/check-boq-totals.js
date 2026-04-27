/**
 * Скрипт для проверки итоговых сумм BOQ
 * Сравнивает суммы из разных методов расчёта
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function checkBoqTotals() {
  // Получаем список тендеров
  const { data: tenders, error: tendersError } = await supabase
    .from('tenders')
    .select('id, title, version')
    .order('created_at', { ascending: false })
    .limit(10);

  if (tendersError) {
    console.error('Error fetching tenders:', tendersError);
    return;
  }

  console.log('='.repeat(80));
  console.log('Проверка итоговых сумм BOQ для тендеров');
  console.log('='.repeat(80));

  for (const tender of tenders) {
    console.log(`\n--- ${tender.title} v${tender.version} ---`);

    // Метод 1: Прямой запрос суммы по tender_id С БАТЧИНГОМ
    let allDirectItems = [];
    let from = 0;
    const directBatchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: directSum, error: directError } = await supabase
        .from('boq_items')
        .select('total_amount')
        .eq('tender_id', tender.id)
        .range(from, from + directBatchSize - 1);

      if (directError) {
        console.error('Error direct sum:', directError);
        break;
      }

      if (directSum && directSum.length > 0) {
        allDirectItems = [...allDirectItems, ...directSum];
        from += directBatchSize;
        hasMore = directSum.length === directBatchSize;
      } else {
        hasMore = false;
      }
    }

    const totalDirect = allDirectItems.reduce((sum, item) => sum + (Number(item.total_amount) || 0), 0);
    console.log(`Метод 1 (прямой по tender_id): ${Math.round(totalDirect).toLocaleString('ru-RU')}`);
    console.log(`  Количество записей: ${allDirectItems.length}`);

    // Метод 2: Через позиции С БАТЧИНГОМ (как должно быть в Dashboard)
    let allPositions = [];
    from = 0;
    const positionBatchSize = 1000;
    hasMore = true;

    while (hasMore) {
      const { data: positions } = await supabase
        .from('client_positions')
        .select('id')
        .eq('tender_id', tender.id)
        .order('position_number', { ascending: true })
        .range(from, from + positionBatchSize - 1);

      if (positions && positions.length > 0) {
        allPositions = [...allPositions, ...positions];
        from += positionBatchSize;
        hasMore = positions.length === positionBatchSize;
      } else {
        hasMore = false;
      }
    }

    if (allPositions.length > 0) {
      const positionIds = allPositions.map(p => p.id);

      // Загружаем все boq_items батчами
      let allBoqItems = [];
      const batchSize = 100;

      for (let i = 0; i < positionIds.length; i += batchSize) {
        const batch = positionIds.slice(i, i + batchSize);
        const { data: boqData } = await supabase
          .from('boq_items')
          .select('total_amount')
          .in('client_position_id', batch);

        if (boqData) {
          allBoqItems = [...allBoqItems, ...boqData];
        }
      }

      const totalViaPositions = allBoqItems.reduce((sum, item) => sum + (Number(item.total_amount) || 0), 0);
      console.log(`Метод 2 (через позиции):       ${Math.round(totalViaPositions).toLocaleString('ru-RU')}`);
      console.log(`  Количество записей: ${allBoqItems.length}`);
      console.log(`  Количество позиций: ${allPositions.length}`);

      // Сравнение
      const diff = Math.abs(totalDirect - totalViaPositions);
      if (diff > 1) {
        console.log(`  ⚠️ РАСХОЖДЕНИЕ: ${Math.round(diff).toLocaleString('ru-RU')}`);
      } else {
        console.log(`  ✓ Суммы совпадают`);
      }
    }
  }
}

checkBoqTotals().catch(console.error);
