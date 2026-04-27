// Восстановить правильные значения с учётом валюты
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function restoreValues() {
  // Получить курс из тендера
  const { data: tender } = await supabase
    .from('tenders')
    .select('usd_rate')
    .ilike('title', '%События%')
    .eq('version', 1)
    .single();

  console.log('Курс USD в тендере:', tender.usd_rate);

  const materials = [
    {
      id: '308fb0c9-2ed5-4aba-92e8-eb23cce13fab',
      name: 'ЕАЕ KXА; 41504 ШП T1',
      quantity: 1,
      unit_rate: 36220.49,
      delivery_amount: 0,
      currency_type: 'USD',
    },
    {
      id: '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c',
      name: 'ЕАЕ KX; 41504 ШП T2',
      quantity: 1,
      unit_rate: 41240.86,
      delivery_amount: 0,
      currency_type: 'USD',
    },
  ];

  for (const material of materials) {
    const currencyRate = tender.usd_rate;
    const correctTotal = material.quantity * material.unit_rate * currencyRate + material.delivery_amount;

    console.log(`\n=== ${material.name} ===`);
    console.log(`${material.quantity} * ${material.unit_rate} ${material.currency_type} * ${currencyRate} + ${material.delivery_amount} = ${correctTotal.toFixed(2)} RUB`);

    const { error } = await supabase
      .from('boq_items')
      .update({ total_amount: correctTotal })
      .eq('id', material.id);

    if (error) {
      console.error('Ошибка:', error);
    } else {
      console.log('✅ Восстановлено:', correctTotal.toFixed(2), 'RUB');
    }
  }
}

restoreValues();
