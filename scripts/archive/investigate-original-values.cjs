// Исследовать исходные значения
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function investigate() {
  // Исходные значения из сообщения пользователя
  const originalValues = [
    {
      id: '308fb0c9-2ed5-4aba-92e8-eb23cce13fab',
      name: 'ЕАЕ KXА; 41504 ШП T1',
      original_total: 3544174.95,
    },
    {
      id: '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c',
      name: 'ЕАЕ KX; 41504 ШП T2',
      original_total: 4035418.15,
    },
  ];

  const { data: tender } = await supabase
    .from('tenders')
    .select('usd_rate')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log('Текущий курс USD в тендере:', tender.usd_rate);

  for (const orig of originalValues) {
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
        consumption_coefficient,
        conversion_coefficient,
        delivery_price_type
      `)
      .eq('id', orig.id)
      .single();

    console.log(`\n\n=== ${item.material_names.name} ===`);
    console.log('Quantity:', item.quantity);
    console.log('Unit rate:', item.unit_rate, item.currency_type);
    console.log('Delivery amount:', item.delivery_amount);
    console.log('Delivery price type:', item.delivery_price_type);
    console.log('Consumption coeff:', item.consumption_coefficient);
    console.log('Conversion coeff:', item.conversion_coefficient);
    console.log('\nИсходная total_amount (из сообщения):', orig.original_total, 'RUB');
    console.log('Текущая total_amount в БД:', item.total_amount, 'RUB');

    // Вычислить какой курс использовался
    const impliedRate = orig.original_total / (item.quantity * item.unit_rate);
    console.log('\nПодразумеваемый курс в исходных данных:', impliedRate.toFixed(2));

    // Попробуем разные формулы
    console.log('\n--- Варианты расчёта ---');

    // 1. С текущим курсом
    const withCurrentRate = item.quantity * item.unit_rate * tender.usd_rate + item.delivery_amount;
    console.log(`1. Текущий курс (${tender.usd_rate}):`, withCurrentRate.toFixed(2));

    // 2. С подразумеваемым курсом
    const withImpliedRate = item.quantity * item.unit_rate * impliedRate + item.delivery_amount;
    console.log(`2. Подразумеваемый курс (${impliedRate.toFixed(2)}):`, withImpliedRate.toFixed(2));

    // 3. С коэффициентом расхода
    if (item.consumption_coefficient && item.consumption_coefficient !== 1) {
      const withConsumption = item.quantity * item.consumption_coefficient * item.unit_rate * tender.usd_rate + item.delivery_amount;
      console.log(`3. С коэфф. расхода (${item.consumption_coefficient}):`, withConsumption.toFixed(2));
    }

    // 4. Расчёт доставки "не в цене" (3% от цены)
    if (item.delivery_price_type === 'не в цене') {
      const unitPriceInRub = item.unit_rate * tender.usd_rate;
      const deliveryCalc = Math.round(unitPriceInRub * 0.03 * 100) / 100;
      const totalWithDelivery = item.quantity * unitPriceInRub + deliveryCalc;
      console.log(`4. С доставкой "не в цене" (3%):`, totalWithDelivery.toFixed(2));
      console.log(`   Доставка рассчитана: ${deliveryCalc.toFixed(2)}`);
    }
  }

  console.log('\n\n=== РЕШЕНИЕ ===');
  console.log('Восстановить исходные значения:');
  originalValues.forEach(v => {
    console.log(`  ${v.name}: ${v.original_total} RUB`);
  });
}

investigate();
