const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};

envContent.split(/\r?\n/).forEach(line => {
  line = line.trim();
  if (line && !line.startsWith('#')) {
    const equalIndex = line.indexOf('=');
    if (equalIndex > 0) {
      const key = line.substring(0, equalIndex).trim();
      const value = line.substring(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      envVars[key] = value;
    }
  }
});

const supabase = createClient(
  envVars.VITE_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

async function recalculateUnpinnedMaterials() {
  try {
    console.log('🔍 Поиск непривязанных материалов...\n');

    // Найти все непривязанные материалы
    const { data: materials, error } = await supabase
      .from('boq_items')
      .select('*')
      .in('boq_item_type', ['мат', 'суб-мат', 'мат-комп.'])
      .is('parent_work_item_id', null);

    if (error) {
      console.error('Ошибка получения материалов:', error);
      return;
    }

    console.log(`Найдено ${materials.length} непривязанных материалов\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const material of materials) {
      const rate = material.currency_type === 'USD' ? 95 : material.currency_type === 'EUR' ? 100 : material.currency_type === 'CNY' ? 13 : 1;
      const unitRate = material.unit_rate || 0;
      const consumptionCoeff = material.consumption_coefficient || 1;

      let deliveryPrice = 0;
      if (material.delivery_price_type === 'не в цене') {
        deliveryPrice = Math.round(unitRate * rate * 0.03 * 100) / 100;
      } else if (material.delivery_price_type === 'суммой') {
        deliveryPrice = material.delivery_amount || 0;
      }

      // Новая логика: total_amount = quantity × consumption_coefficient × (unit_rate × rate + delivery)
      const expectedTotal = Math.round(material.quantity * consumptionCoeff * (unitRate * rate + deliveryPrice) * 100) / 100;
      const currentTotal = material.total_amount || 0;

      // Если разница больше 0.01, обновляем
      if (Math.abs(expectedTotal - currentTotal) > 0.01) {
        const { error: updateError } = await supabase
          .from('boq_items')
          .update({ total_amount: expectedTotal })
          .eq('id', material.id);

        if (updateError) {
          console.error(`❌ Ошибка обновления ${material.id}:`, updateError);
        } else {
          updatedCount++;
          console.log(`✅ Обновлено: ${material.id}`);
          console.log(`   Было: ${currentTotal.toFixed(2)}, Стало: ${expectedTotal.toFixed(2)}`);
          console.log(`   Формула: ${material.quantity} × ${consumptionCoeff} × (${unitRate} × ${rate} + ${deliveryPrice})\n`);
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n📊 Итоги:');
    console.log(`   Обновлено: ${updatedCount}`);
    console.log(`   Пропущено (уже корректные): ${skippedCount}`);
    console.log(`   Всего обработано: ${materials.length}`);

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

recalculateUnpinnedMaterials();
