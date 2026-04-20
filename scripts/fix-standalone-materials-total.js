import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем .env.local
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Функция для получения курса валюты
function getCurrencyRate(currency, rates) {
  switch (currency) {
    case 'USD': return rates.usd;
    case 'EUR': return rates.eur;
    case 'CNY': return rates.cny;
    case 'RUB':
    default: return 1;
  }
}

// Функция для вычисления цены доставки
function calculateDeliveryPrice(unitRate, currencyType, deliveryPriceType, deliveryAmount, rates) {
  const rate = getCurrencyRate(currencyType, rates);
  const unitPriceInRub = unitRate * rate;

  if (deliveryPriceType === 'не в цене') {
    return unitPriceInRub * 0.03;
  } else if (deliveryPriceType === 'суммой') {
    return deliveryAmount || 0;
  } else {
    return 0; // 'в цене'
  }
}

async function fixStandaloneMaterials() {
  console.log('\n🔧 ИСПРАВЛЕНИЕ TOTAL_AMOUNT ДЛЯ НЕПРИВЯЗАННЫХ МАТЕРИАЛОВ\n');
  console.log('═══════════════════════════════════════════\n');

  // Получить все непривязанные материалы
  const { data: materials, error: materialsError } = await supabase
    .from('boq_items')
    .select('*')
    .in('boq_item_type', ['мат', 'суб-мат', 'мат-комп.'])
    .is('parent_work_item_id', null);

  if (materialsError) {
    console.error('❌ Ошибка при получении материалов:', materialsError);
    return;
  }

  console.log(`📦 Найдено непривязанных материалов: ${materials.length}\n`);

  // Получить курсы валют для каждого тендера
  const tenderIds = [...new Set(materials.map(m => m.tender_id))];
  const tendersMap = new Map();

  for (const tenderId of tenderIds) {
    const { data: tender } = await supabase
      .from('tenders')
      .select('usd_rate, eur_rate, cny_rate')
      .eq('id', tenderId)
      .single();

    if (tender) {
      tendersMap.set(tenderId, {
        usd: tender.usd_rate || 100,
        eur: tender.eur_rate || 105,
        cny: tender.cny_rate || 13.5,
      });
    }
  }

  let fixed = 0;
  let skipped = 0;

  for (const material of materials) {
    const rates = tendersMap.get(material.tender_id) || { usd: 100, eur: 105, cny: 13.5 };

    // Вычислить правильную сумму
    const qty = material.quantity || 0;
    const unitRate = material.unit_rate || 0;
    const rate = getCurrencyRate(material.currency_type, rates);
    const deliveryPrice = calculateDeliveryPrice(
      unitRate,
      material.currency_type,
      material.delivery_price_type,
      material.delivery_amount,
      rates
    );

    const correctTotal = Math.round(qty * (unitRate * rate + deliveryPrice) * 100) / 100;
    const currentTotal = material.total_amount || 0;

    // Если разница больше 0.01 - исправить
    if (Math.abs(correctTotal - currentTotal) > 0.01) {
      console.log(`🔧 Исправление материала ${material.id.substring(0, 8)}...`);
      console.log(`   Старая сумма: ${currentTotal.toFixed(2)} ₽`);
      console.log(`   Новая сумма:  ${correctTotal.toFixed(2)} ₽`);
      console.log(`   (qty=${qty}, unit_rate=${unitRate}, delivery=${deliveryPrice.toFixed(2)})\n`);

      const { error: updateError } = await supabase
        .from('boq_items')
        .update({ total_amount: correctTotal })
        .eq('id', material.id);

      if (updateError) {
        console.error(`   ❌ Ошибка обновления:`, updateError);
      } else {
        fixed++;
      }
    } else {
      skipped++;
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`✅ Исправлено: ${fixed}`);
  console.log(`⏭️  Пропущено (уже корректные): ${skipped}`);
}

fixStandaloneMaterials();
