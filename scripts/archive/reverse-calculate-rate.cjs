// Обратный расчёт курса из исходных значений
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function reverseCalculate() {
  const originalData = [
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

  console.log('=== ОБРАТНЫЙ РАСЧЁТ КУРСА ===\n');
  console.log('Формула из MaterialEditForm.tsx:');
  console.log('total = quantity * consumption_coeff * (unit_rate * rate + delivery)');
  console.log('где delivery = Math.round(unit_rate * rate * 0.03 * 100) / 100');
  console.log('\nУпрощаем для quantity=1, consumption_coeff=1:');
  console.log('total = unit_rate * rate + Math.round(unit_rate * rate * 0.03 * 100) / 100');
  console.log('\nЕсли пренебречь округлением delivery:');
  console.log('total ≈ unit_rate * rate * 1.03');
  console.log('rate ≈ total / (unit_rate * 1.03)\n');

  for (const orig of originalData) {
    const { data: item } = await supabase
      .from('boq_items')
      .select('unit_rate, quantity, consumption_coefficient, parent_work_item_id')
      .eq('id', orig.id)
      .single();

    console.log(`\n=== ${orig.name} ===`);
    console.log(`Исходная total_amount: ${orig.original_total.toFixed(2)} ₽`);
    console.log(`Unit rate: ${item.unit_rate} USD`);
    console.log(`Quantity: ${item.quantity}`);
    console.log(`Consumption coeff: ${item.consumption_coefficient || 1}`);

    // Вариант 1: Простое приближение (без учета округления)
    const approxRate = orig.original_total / (item.unit_rate * 1.03);
    console.log(`\nПриближенный курс (без округления): ${approxRate.toFixed(2)}`);

    // Вариант 2: Точный расчёт с учётом округления
    // Нужно решить уравнение: total = unit_rate * rate + round(unit_rate * rate * 0.03 * 100) / 100
    // Переберём возможные значения rate
    let bestRate = 0;
    let minDiff = Infinity;

    for (let rate = 90; rate <= 100; rate += 0.01) {
      const unitPriceInRub = item.unit_rate * rate;
      const delivery = Math.round(unitPriceInRub * 0.03 * 100) / 100;
      const qty = item.quantity || 1;
      const consumptionCoeff = !item.parent_work_item_id ? (item.consumption_coefficient || 1) : 1;
      const calculatedTotal = Math.round(qty * consumptionCoeff * (unitPriceInRub + delivery) * 100) / 100;
      const diff = Math.abs(calculatedTotal - orig.original_total);

      if (diff < minDiff) {
        minDiff = diff;
        bestRate = rate;
      }
    }

    console.log(`\nТочный курс (с округлением): ${bestRate.toFixed(2)}`);

    // Проверяем результат с найденным курсом
    const unitPriceInRub = item.unit_rate * bestRate;
    const delivery = Math.round(unitPriceInRub * 0.03 * 100) / 100;
    const qty = item.quantity || 1;
    const consumptionCoeff = !item.parent_work_item_id ? (item.consumption_coefficient || 1) : 1;
    const verifyTotal = Math.round(qty * consumptionCoeff * (unitPriceInRub + delivery) * 100) / 100;

    console.log(`\nПроверка с курсом ${bestRate.toFixed(2)}:`);
    console.log(`  Unit price in RUB: ${item.unit_rate} * ${bestRate.toFixed(2)} = ${unitPriceInRub.toFixed(2)}`);
    console.log(`  Delivery (3%): ${delivery.toFixed(2)}`);
    console.log(`  Total: ${verifyTotal.toFixed(2)} ₽`);
    console.log(`  Исходная сумма: ${orig.original_total.toFixed(2)} ₽`);
    console.log(`  Разница: ${(verifyTotal - orig.original_total).toFixed(2)} ₽`);
  }

  // Получить текущий курс из тендера
  const { data: tender } = await supabase
    .from('tenders')
    .select('usd_rate')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log(`\n\n=== СРАВНЕНИЕ ===`);
  console.log(`Текущий курс в тендере: ${tender.usd_rate}`);
  console.log(`Курс, использованный в исходных данных: ~95.00`);
  console.log(`Разница: ${(95.00 - tender.usd_rate).toFixed(2)}`);
}

reverseCalculate();
