// Исправить total_amount с учётом доставки 3%
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function fixWithDelivery() {
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
        parent_work_item_id
      `)
      .eq('id', id)
      .single();

    console.log(`\n\n=== ${item.material_names.name} ===`);
    console.log('Параметры:');
    console.log('  Quantity:', item.quantity);
    console.log('  Unit rate:', item.unit_rate, item.currency_type);
    console.log('  Currency rate:', tender.usd_rate);
    console.log('  Delivery price type:', item.delivery_price_type);
    console.log('  Consumption coeff:', item.consumption_coefficient);
    console.log('  Parent work item:', item.parent_work_item_id || 'null (непривязанный материал)');

    // Повторяем логику из MaterialEditForm.tsx
    const rate = tender.usd_rate;
    const unitPriceInRub = item.unit_rate * rate;

    // calculateDeliveryPrice()
    let deliveryPrice = 0;
    if (item.delivery_price_type === 'не в цене') {
      deliveryPrice = Math.round(unitPriceInRub * 0.03 * 100) / 100;
    } else if (item.delivery_price_type === 'суммой') {
      deliveryPrice = item.delivery_amount || 0;
    } else {
      // 'в цене'
      deliveryPrice = 0;
    }

    // calculateTotal()
    const qty = item.quantity || 0;
    const consumptionCoeff = !item.parent_work_item_id ? (item.consumption_coefficient || 1) : 1;
    const correctTotal = qty * consumptionCoeff * (item.unit_rate * rate + deliveryPrice);
    const roundedTotal = Math.round(correctTotal * 100) / 100;

    console.log('\nРасчёт:');
    console.log(`  Unit price in RUB: ${item.unit_rate} * ${rate} = ${unitPriceInRub.toFixed(2)}`);
    console.log(`  Delivery (3%): ${deliveryPrice.toFixed(2)}`);
    console.log(`  Formula: ${qty} * ${consumptionCoeff} * (${unitPriceInRub.toFixed(2)} + ${deliveryPrice.toFixed(2)})`);
    console.log(`  Total: ${roundedTotal.toFixed(2)} RUB`);

    console.log('\nТекущее значение в БД:', item.total_amount);
    console.log('Новое значение:', roundedTotal.toFixed(2));
    console.log('Разница:', (roundedTotal - item.total_amount).toFixed(2));

    // Обновить значение
    const { error } = await supabase
      .from('boq_items')
      .update({ total_amount: roundedTotal })
      .eq('id', id);

    if (error) {
      console.error('❌ Ошибка при обновлении:', error.message);
    } else {
      console.log('✅ Значение обновлено');
    }
  }

  console.log('\n\n=== ПРОВЕРКА ИСХОДНЫХ ЗНАЧЕНИЙ ===');
  console.log('Исходные значения были:');
  console.log('  Материал 1: 3,544,174.95 ₽');
  console.log('  Материал 2: 4,035,418.15 ₽');
  console.log('\nЕсли использовать курс 97.85 (вместо 80.85):');

  const wrongRate = 97.85;
  for (const id of materialIds) {
    const { data: item } = await supabase
      .from('boq_items')
      .select('material_names (name), quantity, unit_rate, consumption_coefficient, parent_work_item_id')
      .eq('id', id)
      .single();

    const unitPriceInRub = item.unit_rate * wrongRate;
    const deliveryPrice = Math.round(unitPriceInRub * 0.03 * 100) / 100;
    const consumptionCoeff = !item.parent_work_item_id ? (item.consumption_coefficient || 1) : 1;
    const totalWithWrongRate = Math.round(item.quantity * consumptionCoeff * (item.unit_rate * wrongRate + deliveryPrice) * 100) / 100;

    console.log(`\n${item.material_names.name}:`);
    console.log(`  С курсом 97.85: ${totalWithWrongRate.toFixed(2)} ₽`);
  }
}

fixWithDelivery();
