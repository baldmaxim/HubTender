/**
 * Скрипт для проверки расхождения коммерческой стоимости
 * между Финансовыми показателями и Коммерцией
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCommercialTotals() {
  try {
    console.log('🔍 Поиск тендера "ЖК События 6.2"...\n');

    // Найти тендер
    const { data: tenders } = await supabase
      .from('tenders')
      .select('*')
      .ilike('title', '%События%')
      .order('version', { ascending: false });

    if (!tenders || tenders.length === 0) {
      console.log('❌ Тендер не найден');
      return;
    }

    const tender = tenders.find(t => (t.version || 1) === 2) || tenders[0];
    console.log(`Тендер: ${tender.title} (версия ${tender.version || 1})`);
    console.log(`ID: ${tender.id}\n`);

    // Загрузить ВСЕ boq_items с батчингом
    console.log('📥 Загрузка BOQ элементов с батчингом...\n');

    let allBoqItems = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    let batchNum = 1;

    while (hasMore) {
      console.log(`  Батч ${batchNum}: загрузка элементов ${from + 1} - ${from + batchSize}...`);

      const { data, error } = await supabase
        .from('boq_items')
        .select('*')
        .eq('tender_id', tender.id)
        .range(from, from + batchSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allBoqItems = [...allBoqItems, ...data];
        console.log(`  ✅ Загружено: ${data.length} элементов`);
        from += batchSize;
        hasMore = data.length === batchSize;
        batchNum++;
      } else {
        hasMore = false;
      }
    }

    console.log(`\n✅ Всего загружено BOQ элементов: ${allBoqItems.length}\n`);

    console.log(`${'='.repeat(80)}`);
    console.log(`РАСЧЕТ КОММЕРЧЕСКОЙ СТОИМОСТИ - РАЗНЫЕ МЕТОДЫ`);
    console.log(`${'='.repeat(80)}\n`);

    // МЕТОД 1: Как в Commerce (useCommerceData.ts)
    console.log(`1️⃣  МЕТОД COMMERCE (total_commercial_material_cost + total_commercial_work_cost):\n`);

    let commerceTotal = 0;
    let commerceMaterial = 0;
    let commerceWork = 0;
    let commerceBaseTotal = 0;

    allBoqItems.forEach(item => {
      const mat = item.total_commercial_material_cost || 0;
      const work = item.total_commercial_work_cost || 0;
      const base = item.total_amount || 0;

      commerceMaterial += mat;
      commerceWork += work;
      commerceTotal += (mat + work);
      commerceBaseTotal += base;
    });

    console.log(`   Материалы (КП): ${commerceMaterial.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
    console.log(`   Работы (КП): ${commerceWork.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
    console.log(`   Базовая стоимость: ${commerceBaseTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
    console.log(`   ИТОГО коммерческая: ${commerceTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.\n`);

    // МЕТОД 2: Через calculated_price (как может быть в FinancialIndicators)
    console.log(`2️⃣  МЕТОД ЧЕРЕЗ calculated_price (calculated_price × quantity):\n`);

    let calcPriceTotal = 0;
    let withCalcPrice = 0;
    let withoutCalcPrice = 0;

    allBoqItems.forEach(item => {
      if (item.calculated_price != null) {
        calcPriceTotal += (item.calculated_price || 0) * (item.quantity || 0);
        withCalcPrice++;
      } else {
        withoutCalcPrice++;
      }
    });

    console.log(`   Элементов с calculated_price: ${withCalcPrice}`);
    console.log(`   Элементов без calculated_price: ${withoutCalcPrice}`);
    console.log(`   ИТОГО: ${calcPriceTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.\n`);

    // МЕТОД 3: Через total_price
    console.log(`3️⃣  МЕТОД ЧЕРЕЗ total_price (sum of total_price):\n`);

    let totalPriceSum = 0;
    let withTotalPrice = 0;
    let withoutTotalPrice = 0;

    allBoqItems.forEach(item => {
      if (item.total_price != null) {
        totalPriceSum += item.total_price || 0;
        withTotalPrice++;
      } else {
        withoutTotalPrice++;
      }
    });

    console.log(`   Элементов с total_price: ${withTotalPrice}`);
    console.log(`   Элементов без total_price: ${withoutTotalPrice}`);
    console.log(`   ИТОГО: ${totalPriceSum.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.\n`);

    // МЕТОД 4: Через initial_price (базовый)
    console.log(`4️⃣  МЕТОД ЧЕРЕЗ initial_price (initial_price × quantity):\n`);

    let initialPriceTotal = 0;

    allBoqItems.forEach(item => {
      initialPriceTotal += (item.initial_price || 0) * (item.quantity || 0);
    });

    console.log(`   ИТОГО: ${initialPriceTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.\n`);

    // АНАЛИЗ РАСХОЖДЕНИЙ
    console.log(`${'='.repeat(80)}`);
    console.log(`АНАЛИЗ РАСХОЖДЕНИЙ`);
    console.log(`${'='.repeat(80)}\n`);

    const targetCommerce = 2204922582.95;
    const targetFinancial = 2455730033;

    console.log(`Ожидаемые значения:`);
    console.log(`   Commerce (Форма КП): ${targetCommerce.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
    console.log(`   FinancialIndicators: ${targetFinancial.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.\n`);

    const methods = [
      { name: 'МЕТОД 1 (Commerce)', value: commerceTotal },
      { name: 'МЕТОД 2 (calculated_price)', value: calcPriceTotal },
      { name: 'МЕТОД 3 (total_price)', value: totalPriceSum },
      { name: 'МЕТОД 4 (initial_price)', value: initialPriceTotal }
    ];

    console.log(`Совпадения с целевыми значениями:\n`);

    methods.forEach(method => {
      const diffCommerce = Math.abs(method.value - targetCommerce);
      const diffFinancial = Math.abs(method.value - targetFinancial);

      console.log(`${method.name}:`);
      console.log(`   Значение: ${method.value.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);

      if (diffCommerce < 100) {
        console.log(`   ✅ СОВПАДАЕТ с Commerce (разница: ${diffCommerce.toFixed(2)} руб.)`);
      } else {
        console.log(`   ❌ Разница с Commerce: ${diffCommerce.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
      }

      if (diffFinancial < 100) {
        console.log(`   ✅ СОВПАДАЕТ с FinancialIndicators (разница: ${diffFinancial.toFixed(2)} руб.)`);
      } else {
        console.log(`   ❌ Разница с FinancialIndicators: ${diffFinancial.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} руб.`);
      }

      console.log('');
    });

    // ДЕТАЛЬНАЯ ПРОВЕРКА: сравнение полей в первых 10 элементах
    console.log(`${'='.repeat(80)}`);
    console.log(`ДЕТАЛИ ПЕРВЫХ 10 ЭЛЕМЕНТОВ`);
    console.log(`${'='.repeat(80)}\n`);

    allBoqItems.slice(0, 10).forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.boq_item_type} - ${item.work_name || item.material_name || 'Без названия'}`);
      console.log(`   quantity: ${item.quantity || 0}`);
      console.log(`   initial_price: ${(item.initial_price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   calculated_price: ${(item.calculated_price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_amount: ${(item.total_amount || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_price: ${(item.total_price || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_commercial_material_cost: ${(item.total_commercial_material_cost || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log(`   total_commercial_work_cost: ${(item.total_commercial_work_cost || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

checkCommercialTotals();
