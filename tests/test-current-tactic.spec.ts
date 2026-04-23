import { test, expect } from '@playwright/test';

test('Проверка текущей схемы наценок', async ({ page }) => {
  // Переходим на страницу Commerce
  await page.goto('http://localhost:5185/commerce');

  // Ждем загрузки страницы
  await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

  // Выбираем первый тендер
  const tenderSelect = page.locator('.ant-select').first();
  await tenderSelect.click();
  await page.waitForTimeout(500);

  const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
  if (await tenderOption.isVisible()) {
    await tenderOption.click();
    await page.waitForTimeout(1500);

    console.log('✅ Тендер выбран');

    // Получаем информацию о текущей схеме
    const tacticInfo = await page.evaluate(() => {
      const tenderId = localStorage.getItem('selectedTenderId');
      return { tenderId };
    });

    console.log('Тендер ID:', tacticInfo.tenderId);

    // Проверяем текущую схему наценок через прямой запрос к БД
    const tacticData = await page.evaluate(async () => {
      const { createClient } = await import('@supabase/supabase-js');

      // Получаем credentials из окружения
      const supabaseUrl = (window as any).VITE_SUPABASE_URL || localStorage.getItem('supabaseUrl');
      const supabaseKey = (window as any).VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabaseKey');

      if (!supabaseUrl || !supabaseKey) {
        return { error: 'Не удалось получить параметры Supabase' };
      }

      const supabase = createClient(supabaseUrl, supabaseKey);
      const tenderId = localStorage.getItem('selectedTenderId');

      // Получаем тендер и его схему
      const { data: tender } = await supabase
        .from('tenders')
        .select('*, markup_tactics(*)')
        .eq('id', tenderId)
        .single();

      // Получаем BOQ элементы
      const { data: boqItems } = await supabase
        .from('boq_items')
        .select('*')
        .eq('tender_id', tenderId);

      return { tender, boqItems };
    });

    if (tacticData.tender) {
      console.log('\n📋 ИНФОРМАЦИЯ О СХЕМЕ:');
      console.log('Название схемы:', tacticData.tender.markup_tactics?.name);
      console.log('ID схемы:', tacticData.tender.markup_tactics?.id);
      console.log('Глобальная:', tacticData.tender.markup_tactics?.is_global ? 'Да' : 'Нет');
    }

    // Нажимаем "Пересчитать"
    const recalcButton = page.locator('button:has-text("Пересчитать")');
    console.log('\n🔄 Нажимаем "Пересчитать"...');
    await recalcButton.click();

    // Ждем завершения расчета
    await page.waitForTimeout(5000);

    console.log('✅ Пересчёт завершён');

    // Проверяем результаты
    const results = await page.evaluate(async () => {
      const { createClient } = await import('@supabase/supabase-js');

      const supabaseUrl = (window as any).VITE_SUPABASE_URL || localStorage.getItem('supabaseUrl');
      const supabaseKey = (window as any).VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabaseKey');

      const supabase = createClient(supabaseUrl, supabaseKey);
      const tenderId = localStorage.getItem('selectedTenderId');

      // Получаем обновленные BOQ элементы
      const { data: boqItems } = await supabase
        .from('boq_items')
        .select('*')
        .eq('tender_id', tenderId);

      // Группируем по типам и считаем коэффициенты
      const byType: any = {};

      if (boqItems) {
        boqItems.forEach((item: any) => {
          if (!byType[item.boq_item_type]) {
            byType[item.boq_item_type] = [];
          }

          const isMaterial = ['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type);
          const commercialCost = isMaterial
            ? item.total_commercial_material_cost
            : item.total_commercial_work_cost;

          const coefficient = item.total_amount > 0
            ? commercialCost / item.total_amount
            : 0;

          byType[item.boq_item_type].push({
            id: item.id,
            name: item.name,
            base: item.total_amount,
            commercial: commercialCost,
            coefficient
          });
        });
      }

      return byType;
    });

    console.log('\n📊 РЕЗУЛЬТАТЫ ПЕРЕСЧЁТА:');
    console.log('═══════════════════════════════════════════');

    const expectedCoeffs = {
      'мат': 1.640760,
      'раб': 2.885148,
      'суб-мат': 1.403600,
      'суб-раб': 1.403600
    };

    for (const [type, items] of Object.entries(results)) {
      console.log(`\n${type.toUpperCase()}:`);
      items.forEach((item: any) => {
        const expected = expectedCoeffs[type] || null;
        const isCorrect = expected ? Math.abs(item.coefficient - expected) < 0.01 : null;
        const status = isCorrect === null ? '❓' : (isCorrect ? '✅' : '❌');

        console.log(`  Коэффициент: ${item.coefficient.toFixed(6)} ${status}`);

        if (expected && !isCorrect) {
          console.log(`  Ожидалось: ${expected.toFixed(6)}`);
          console.log(`  Разница: ${(item.coefficient / expected).toFixed(2)}x`);

          // Анализ проблемы
          if (item.coefficient > expected * 5) {
            console.log(`  ⚠️ Коэффициент завышен в ${(item.coefficient / expected).toFixed(1)} раз!`);
          } else if (item.coefficient < expected * 0.5) {
            console.log(`  ⚠️ Коэффициент занижен!`);
          }
        }

        console.log(`  База: ${item.base}`);
        console.log(`  Коммерч.: ${item.commercial}`);
      });
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('\n📌 ВЫВОДЫ:');

    // Анализируем проблемы
    const matCoeff = results['мат']?.[0]?.coefficient;
    const rabCoeff = results['раб']?.[0]?.coefficient;
    const subMatCoeff = results['суб-мат']?.[0]?.coefficient;
    const subRabCoeff = results['суб-раб']?.[0]?.coefficient;

    if (matCoeff && matCoeff > 10) {
      console.log('❌ МАТ: Коэффициент завышен в ~10 раз');
    }
    if (rabCoeff && rabCoeff > 10) {
      console.log('❌ РАБ: Коэффициент завышен в ~10 раз');
    }
    if (subMatCoeff && Math.abs(subMatCoeff - 1.4036) > 0.01) {
      console.log('❌ СУБ-МАТ: Неправильный коэффициент');
    }
    if (subRabCoeff && Math.abs(subRabCoeff - 1.4036) > 0.01) {
      console.log('❌ СУБ-РАБ: Неправильный коэффициент');
    }
  }
});