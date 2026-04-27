// Проверить детали доставки
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkDelivery() {
  const materialIds = [
    '308fb0c9-2ed5-4aba-92e8-eb23cce13fab', // ЕАЕ KXА
    '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c', // ЕАЕ KX
  ];

  // Получить курс USD из тендера
  const { data: tender } = await supabase
    .from('tenders')
    .select('usd_rate')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log('Курс USD в тендере:', tender.usd_rate);

  for (const id of materialIds) {
    const { data: item } = await supabase
      .from('boq_items')
      .select(`
        id,
        material_names (name),
        quantity,
        unit_rate,
        delivery_amount,
        total_amount,
        currency_type,
        delivery_price_type,
        consumption_coefficient,
        conversion_coefficient
      `)
      .eq('id', id)
      .single();

    console.log(`\n\n=== ${item.material_names.name} ===`);
    console.log('Quantity:', item.quantity);
    console.log('Unit rate:', item.unit_rate, item.currency_type);
    console.log('Delivery amount:', item.delivery_amount, 'RUB');
    console.log('Delivery price type:', item.delivery_price_type);
    console.log('Consumption coeff:', item.consumption_coefficient);
    console.log('Conversion coeff:', item.conversion_coefficient);
    console.log('\nТекущая total_amount в БД:', item.total_amount, 'RUB');

    // Правильный расчёт с учётом доставки
    const correctTotal = item.quantity * item.unit_rate * tender.usd_rate + item.delivery_amount;
    console.log('\nПравильный расчёт:');
    console.log(`${item.quantity} * ${item.unit_rate} USD * ${tender.usd_rate} + ${item.delivery_amount} = ${correctTotal.toFixed(2)} RUB`);
    console.log('Разница:', (item.total_amount - correctTotal).toFixed(2), 'RUB');

    // Попробуем вычислить какая была исходная сумма
    // Если исходная была 3,544,174.95 и 4,035,418.15
    const originalTotals = {
      '308fb0c9-2ed5-4aba-92e8-eb23cce13fab': 3544174.95,
      '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c': 4035418.15,
    };

    const originalTotal = originalTotals[id];
    console.log('\n--- Анализ исходных данных ---');
    console.log('Исходная сумма:', originalTotal, 'RUB');

    // Вычислить какой курс подразумевался
    const impliedRate = (originalTotal - item.delivery_amount) / (item.quantity * item.unit_rate);
    console.log('Подразумеваемый курс:', impliedRate.toFixed(2));
  }
}

checkDelivery();
