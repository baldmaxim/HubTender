require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixDeliveryRounding() {
  try {
    console.log('Загрузка материалов с доставкой "не в цене"...');

    // Получить все материалы с доставкой "не в цене"
    const { data: items, error } = await supabase
      .from('boq_items')
      .select('id, quantity, unit_rate, currency_type, delivery_price_type, tenders(usd_rate, eur_rate, cny_rate)')
      .in('boq_item_type', ['мат', 'суб-мат', 'мат-комп.'])
      .eq('delivery_price_type', 'не в цене');

    if (error) throw error;

    console.log(`Найдено материалов: ${items.length}`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const quantity = item.quantity || 0;
      const unitRate = item.unit_rate || 0;

      // Получить курс валюты
      let rate = 1;
      if (item.currency_type === 'USD') {
        rate = item.tenders?.usd_rate || 1;
      } else if (item.currency_type === 'EUR') {
        rate = item.tenders?.eur_rate || 1;
      } else if (item.currency_type === 'CNY') {
        rate = item.tenders?.cny_rate || 1;
      }

      // Рассчитать доставку с округлением до 2 знаков
      const deliveryPrice = Math.round(unitRate * rate * 0.03 * 100) / 100;

      // Рассчитать новую итоговую сумму
      const newTotalAmount = quantity * (unitRate * rate + deliveryPrice);
      const rounded = Math.round(newTotalAmount * 100) / 100;

      // Обновить запись
      const { error: updateError } = await supabase
        .from('boq_items')
        .update({ total_amount: rounded })
        .eq('id', item.id);

      if (updateError) {
        console.error(`Ошибка обновления ${item.id}:`, updateError.message);
        skippedCount++;
      } else {
        updatedCount++;
      }
    }

    console.log(`\nГотово!`);
    console.log(`Обновлено: ${updatedCount}`);
    console.log(`Пропущено: ${skippedCount}`);

  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

fixDeliveryRounding();
