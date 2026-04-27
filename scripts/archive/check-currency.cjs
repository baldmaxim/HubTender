// Проверка валюты материалов
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkCurrency() {
  try {
    // ID материалов с проблемами
    const materialIds = [
      '308fb0c9-2ed5-4aba-92e8-eb23cce13fab', // ЕАЕ KXА; 41504 ШП T1
      '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c', // ЕАЕ KX; 41504 ШП T2
    ];

    // Получить курсы валют из тендера
    const { data: tender } = await supabase
      .from('tenders')
      .select('id, title, version, usd_rate, eur_rate, cny_rate')
      .ilike('title', '%События%')
      .eq('version', 1)
      .single();

    console.log('\n=== КУРСЫ ВАЛЮТ В ТЕНДЕРЕ ===');
    console.log('USD:', tender.usd_rate);
    console.log('EUR:', tender.eur_rate);
    console.log('CNY:', tender.cny_rate);

    for (const materialId of materialIds) {
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
          consumption_coefficient
        `)
        .eq('id', materialId)
        .single();

      console.log(`\n\n=== ${item.material_names?.name} ===`);
      console.log('Количество:', item.quantity);
      console.log('Цена за единицу:', item.unit_rate, item.currency_type);
      console.log('Доставка:', item.delivery_amount);
      console.log('Валюта:', item.currency_type);
      console.log('Коэфф. расхода:', item.consumption_coefficient);
      console.log('Итоговая сумма в БД:', item.total_amount, 'RUB');

      // Получить курс для валюты
      let currencyRate = 1;
      if (item.currency_type === 'USD') {
        currencyRate = tender.usd_rate;
      } else if (item.currency_type === 'EUR') {
        currencyRate = tender.eur_rate;
      } else if (item.currency_type === 'CNY') {
        currencyRate = tender.cny_rate;
      }

      console.log('\nКурс валюты:', currencyRate);

      // Рассчитать правильную сумму
      const quantity = Number(item.quantity) || 0;
      const unitRate = Number(item.unit_rate) || 0;
      const deliveryAmount = Number(item.delivery_amount) || 0;
      const consumptionCoeff = Number(item.consumption_coefficient) || 1;

      // Формула: quantity * unit_rate * currency_rate + delivery_amount
      const calculatedSum = quantity * unitRate * currencyRate + deliveryAmount;

      console.log('\nРасчёт:');
      console.log(`  ${quantity} * ${unitRate} * ${currencyRate} + ${deliveryAmount} = ${calculatedSum.toFixed(2)}`);
      console.log(`  Итоговая сумма в БД: ${item.total_amount}`);
      console.log(`  Разница: ${(item.total_amount - calculatedSum).toFixed(2)}`);

      if (Math.abs(item.total_amount - calculatedSum) > 0.01) {
        console.log('  ⚠️  НЕСООТВЕТСТВИЕ!');

        // Попробуем с коэффициентом расхода
        const withConsumption = quantity * consumptionCoeff * unitRate * currencyRate + deliveryAmount;
        console.log(`\n  С коэфф. расхода: ${quantity} * ${consumptionCoeff} * ${unitRate} * ${currencyRate} + ${deliveryAmount} = ${withConsumption.toFixed(2)}`);
        console.log(`  Разница: ${(item.total_amount - withConsumption).toFixed(2)}`);

        if (Math.abs(item.total_amount - withConsumption) < 0.01) {
          console.log('  ✅ СОВПАДАЕТ с коэффициентом расхода!');
        }
      } else {
        console.log('  ✅ Итоговая сумма верна');
      }
    }

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

checkCurrency();
