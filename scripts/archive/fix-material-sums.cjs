// Исправить неверные итоговые суммы для материалов
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vswxtmkdsimwgmvzysdo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd3h0bWtkc2ltd2dtdnp5c2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MTYzNTAsImV4cCI6MjA3Nzk5MjM1MH0.sCtBZL_pH8knNrFJqfx7uPMLlos_9HAzkaArlpOyfDY'
);

async function fixMaterialSums() {
  try {
    console.log('Исправление неверных итоговых сумм...\n');

    // ID материалов с проблемами
    const materialIds = [
      '308fb0c9-2ed5-4aba-92e8-eb23cce13fab', // ЕАЕ KXА; 41504 ШП T1
      '399ca0ac-a920-4dd6-9a83-bb3e9dd2863c', // ЕАЕ KX; 41504 ШП T2
    ];

    for (const materialId of materialIds) {
      // Получить текущие данные
      const { data: item, error: fetchError } = await supabase
        .from('boq_items')
        .select('id, material_names (name), quantity, unit_rate, delivery_amount, total_amount')
        .eq('id', materialId)
        .single();

      if (fetchError) {
        console.error(`Ошибка загрузки материала ${materialId}:`, fetchError);
        continue;
      }

      console.log(`\n=== Материал: ${item.material_names?.name} ===`);
      console.log(`ID: ${item.id}`);
      console.log(`Количество: ${item.quantity}`);
      console.log(`Цена за единицу: ${item.unit_rate}`);
      console.log(`Доставка: ${item.delivery_amount || 0}`);
      console.log(`Текущая итоговая сумма в БД: ${item.total_amount}`);

      // Рассчитать правильную сумму
      const quantity = Number(item.quantity) || 0;
      const unitRate = Number(item.unit_rate) || 0;
      const deliveryAmount = Number(item.delivery_amount) || 0;
      const correctSum = quantity * unitRate + deliveryAmount;

      console.log(`Правильная итоговая сумма: ${correctSum.toFixed(2)}`);

      // Обновить сумму в БД
      const { error: updateError } = await supabase
        .from('boq_items')
        .update({ total_amount: correctSum })
        .eq('id', materialId);

      if (updateError) {
        console.error(`Ошибка обновления материала ${materialId}:`, updateError);
      } else {
        console.log('✅ Итоговая сумма успешно исправлена!');
      }
    }

    console.log('\n\n=== ГОТОВО ===\n');
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

fixMaterialSums();
