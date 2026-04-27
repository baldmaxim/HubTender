// Проверить текущие значения в БД
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function checkValues() {
  const materialIds = [
    '308fb0c9-2ed5-4aba-92e8-eb23cce13fab', // ЕАЕ KXА; 41504 ШП T1
    '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c', // ЕАЕ KX; 41504 ШП T2
  ];

  for (const id of materialIds) {
    const { data } = await supabase
      .from('boq_items')
      .select('material_names(name), unit_rate, currency_type, total_amount')
      .eq('id', id)
      .single();

    console.log(`\n${data.material_names.name}`);
    console.log('  unit_rate:', data.unit_rate, data.currency_type);
    console.log('  total_amount:', data.total_amount, 'RUB');
  }
}

checkValues();
