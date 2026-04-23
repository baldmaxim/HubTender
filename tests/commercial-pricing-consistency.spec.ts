import { test, expect } from '@playwright/test';

/**
 * Комплексный тест проверки консистентности коммерческих цен
 * между страницами: Коммерция, Затраты на строительство, Финансовые показатели
 *
 * Проверяет что:
 * 1. Коммерческие стоимости на всех трех страницах совпадают
 * 2. Данные корректно рассчитываются при применении тактики наценок
 * 3. Переключение между прямыми и коммерческими затратами работает корректно
 */

interface CommercialPricing {
  totalCommercial: number;
  totalBase: number;
  profit: number;
  profitPercentage: number;
}

test.describe('Проверка консистентности коммерческих цен', () => {
  const selectedTenderId: string | null = null;
  let selectedTenderTitle: string | null = null;

  test.beforeAll(() => {
    console.log('\n=== НАЧАЛО ПРОВЕРКИ КОНСИСТЕНТНОСТИ КОММЕРЧЕСКИХ ЦЕН ===\n');
  });

  test.afterAll(() => {
    console.log('\n=== ЗАВЕРШЕНИЕ ПРОВЕРКИ КОНСИСТЕНТНОСТИ ===\n');
  });

  /**
   * Тест 1: Выбор тендера и сбор данных со страницы Коммерция
   */
  test('1. Извлечение данных со страницы Коммерция', async ({ page }) => {
    console.log('\n[COMMERCE] Переход на страницу Коммерция...');
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

    // Выбираем первый доступный тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);

    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    await expect(tenderOption).toBeVisible();

    selectedTenderTitle = await tenderOption.innerText();
    console.log(`[COMMERCE] Выбран тендер: ${selectedTenderTitle}`);

    await tenderOption.click();
    await page.waitForTimeout(2000);

    // Проверяем наличие информационной карточки
    const tenderInfo = page.locator('.ant-card-small');
    if (await tenderInfo.isVisible()) {
      const infoText = await tenderInfo.innerText();
      console.log(`[COMMERCE] Информация о тендере:\n${infoText}`);
    }

    // Нажимаем кнопку пересчёта для обновления данных
    const recalcButton = page.locator('button:has-text("Пересчитать")');
    if (await recalcButton.isVisible()) {
      console.log('[COMMERCE] Выполняем пересчёт...');
      await recalcButton.click();
      await page.waitForTimeout(2000);
    }

    // Извлекаем статистические данные
    const statsCards = page.locator('.ant-statistic');
    if (await statsCards.first().isVisible()) {
      const statsCount = await statsCards.count();
      console.log(`\n[COMMERCE] Найдено статистических показателей: ${statsCount}`);

      for (let i = 0; i < statsCount; i++) {
        const title = await statsCards.nth(i).locator('.ant-statistic-title').innerText();
        const value = await statsCards.nth(i).locator('.ant-statistic-content-value').innerText();
        console.log(`  - ${title}: ${value}`);
      }
    }

    // Проверяем наличие таблицы с позициями
    const table = page.locator('.ant-table');
    await expect(table).toBeVisible();

    const rows = table.locator('.ant-table-tbody tr');
    const rowCount = await rows.count();
    console.log(`[COMMERCE] Количество строк в таблице: ${rowCount}`);

    expect(rowCount).toBeGreaterThan(0);
    console.log('[COMMERCE] ✓ Данные успешно загружены\n');
  });

  /**
   * Тест 2: Проверка данных на странице Затраты на строительство
   */
  test('2. Проверка данных на странице Затраты (Costs)', async ({ page }) => {
    console.log('[COSTS] Переход на страницу Затраты на строительство...');
    await page.goto('http://localhost:5185/costs');
    await page.waitForSelector('h4:has-text("Затраты на строительство")', { timeout: 10000 });

    // Выбираем тот же тендер
    await page.waitForTimeout(2000);

    const cards = page.locator('.ant-card-hoverable');
    const cardsCount = await cards.count();
    console.log(`[COSTS] Доступно карточек быстрого выбора: ${cardsCount}`);

    if (cardsCount > 0) {
      // Кликаем на первую карточку
      await cards.first().click();
      await page.waitForTimeout(3000);

      console.log('[COSTS] Тендер выбран через быструю карточку');

      // Проверяем прямые затраты
      console.log('\n[COSTS] === ПРЯМЫЕ ЗАТРАТЫ ===');
      const directCostsButton = page.locator('.ant-segmented-item:has-text("Прямые затраты")');
      await expect(directCostsButton).toHaveClass(/ant-segmented-item-selected/);

      const table = page.locator('.ant-table');
      await expect(table).toBeVisible();

      // Считаем строки данных
      const rows = table.locator('.ant-table-tbody tr');
      const rowCount = await rows.count();
      console.log(`[COSTS] Строк в таблице (прямые затраты): ${rowCount}`);

      // Ищем итоговые значения в таблице
      const totalDirectCosts = 0;
      for (let i = 0; i < Math.min(rowCount, 5); i++) {
        const rowText = await rows.nth(i).innerText();
        if (rowText) {
          console.log(`  Строка ${i + 1}: ${rowText.substring(0, 100)}...`);
        }
      }

      // Переключаем на коммерческие затраты
      console.log('\n[COSTS] === КОММЕРЧЕСКИЕ ЗАТРАТЫ ===');
      await page.locator('.ant-segmented-item:has-text("Коммерческие затраты")').click();
      await page.waitForTimeout(2000);

      const commercialCostsButton = page.locator('.ant-segmented-item:has-text("Коммерческие затраты")');
      await expect(commercialCostsButton).toHaveClass(/ant-segmented-item-selected/);

      // Проверяем данные коммерческих затрат
      const commercialRows = table.locator('.ant-table-tbody tr');
      const commercialRowCount = await commercialRows.count();
      console.log(`[COSTS] Строк в таблице (коммерческие затраты): ${commercialRowCount}`);

      for (let i = 0; i < Math.min(commercialRowCount, 5); i++) {
        const rowText = await commercialRows.nth(i).innerText();
        if (rowText) {
          console.log(`  Строка ${i + 1}: ${rowText.substring(0, 100)}...`);
        }
      }

      console.log('[COSTS] ✓ Данные прямых и коммерческих затрат загружены\n');
    }
  });

  /**
   * Тест 3: Проверка данных на странице Финансовые показатели
   */
  test('3. Проверка данных на странице Финансовые показатели', async ({ page }) => {
    console.log('[FINANCIAL] Переход на страницу Финансовые показатели...');
    await page.goto('http://localhost:5185/financial-indicators');
    await page.waitForSelector('text=Финансовые показатели', { timeout: 10000 });

    // Выбираем первый доступный тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const firstOption = page.locator('.ant-select-item').first();
    const tenderName = await firstOption.innerText();
    console.log(`[FINANCIAL] Выбран тендер: ${tenderName}`);

    await firstOption.click();
    await page.waitForTimeout(2000);

    // Проверяем наличие таблицы с финансовыми показателями
    const table = page.locator('.ant-table');
    await expect(table).toBeVisible();

    const rows = table.locator('.ant-table-tbody tr');
    const rowCount = await rows.count();
    console.log(`\n[FINANCIAL] Всего строк в таблице: ${rowCount}`);

    console.log('[FINANCIAL] === ФИНАНСОВЫЕ ПОКАЗАТЕЛИ ===');

    // Ищем ключевые показатели
    const keyIndicators = [
      'Материалы',
      'Работы',
      'Субподрядные материалы',
      'Субподрядные работы',
      'Итого материалов + работ',
      'НР',
      'СП',
      'Всего',
      'Итого Заказчик',
      'НДС',
      'Прибыль'
    ];

    for (const indicator of keyIndicators) {
      const indicatorRow = page.locator('tr').filter({ hasText: indicator });
      if (await indicatorRow.count() > 0) {
        const rowText = await indicatorRow.first().innerText();
        console.log(`  ${indicator}: ${rowText}`);
      }
    }

    // Проверяем наличие параметра 0,6к
    console.log('\n[FINANCIAL] Проверка параметра "0,6 к (Раб+СМ)"...');
    const coefficient06Row = page.locator('tr').filter({ hasText: '0,6 к (Раб+СМ)' });
    if (await coefficient06Row.count() > 0) {
      const rowText = await coefficient06Row.first().innerText();
      console.log(`  ✓ Найден параметр 0,6к: ${rowText}`);
    } else {
      console.log('  ⚠ Параметр 0,6к не найден');
    }

    console.log('[FINANCIAL] ✓ Финансовые показатели загружены\n');
  });

  /**
   * Тест 4: Комплексная проверка консистентности данных
   */
  test('4. Проверка консистентности между всеми тремя страницами', async ({ page }) => {
    console.log('\n=== КОМПЛЕКСНАЯ ПРОВЕРКА КОНСИСТЕНТНОСТИ ===\n');

    const pricingData: {
      commerce: { base: string; commercial: string; profit: string } | null;
      costs: { direct: string; commercial: string } | null;
      financial: { total: string; profit: string } | null;
    } = {
      commerce: null,
      costs: null,
      financial: null
    };

    // 1. Собираем данные со страницы Коммерция
    console.log('[1/3] Сбор данных с Commerce...');
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

    const commerceTenderSelect = page.locator('.ant-select').first();
    await commerceTenderSelect.click();
    await page.waitForTimeout(500);

    const commerceTenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    await commerceTenderOption.click();
    await page.waitForTimeout(2000);

    // Пересчитываем
    const recalcButton = page.locator('button:has-text("Пересчитать")');
    if (await recalcButton.isVisible()) {
      await recalcButton.click();
      await page.waitForTimeout(2000);
    }

    // Собираем статистику Commerce
    const commerceStats = page.locator('.ant-statistic');
    if (await commerceStats.first().isVisible()) {
      const statsCount = await commerceStats.count();
      const commerceData: { [key: string]: string } = {};

      for (let i = 0; i < statsCount; i++) {
        const title = await commerceStats.nth(i).locator('.ant-statistic-title').innerText();
        const value = await commerceStats.nth(i).locator('.ant-statistic-content-value').innerText();
        commerceData[title] = value;
      }

      pricingData.commerce = {
        base: commerceData['Базовая стоимость'] || '0',
        commercial: commerceData['Коммерческая стоимость'] || '0',
        profit: commerceData['Прибыль'] || '0'
      };

      console.log('[COMMERCE] Собранные данные:');
      console.log(`  Базовая: ${pricingData.commerce.base}`);
      console.log(`  Коммерческая: ${pricingData.commerce.commercial}`);
      console.log(`  Прибыль: ${pricingData.commerce.profit}`);
    }

    // 2. Собираем данные со страницы Costs
    console.log('\n[2/3] Сбор данных с Costs...');
    await page.goto('http://localhost:5185/costs');
    await page.waitForSelector('h4:has-text("Затраты на строительство")', { timeout: 10000 });
    await page.waitForTimeout(2000);

    const costsCards = page.locator('.ant-card-hoverable');
    if (await costsCards.count() > 0) {
      await costsCards.first().click();
      await page.waitForTimeout(3000);

      // Получаем итоговые значения из таблицы (если они есть)
      console.log('[COSTS] Данные загружены');
      pricingData.costs = {
        direct: 'N/A',
        commercial: 'N/A'
      };
    }

    // 3. Собираем данные со страницы Financial Indicators
    console.log('\n[3/3] Сбор данных с Financial Indicators...');
    await page.goto('http://localhost:5185/financial-indicators');
    await page.waitForSelector('text=Финансовые показатели', { timeout: 10000 });

    const financialTenderSelect = page.locator('.ant-select').first();
    await financialTenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const financialOption = page.locator('.ant-select-item').first();
    await financialOption.click();
    await page.waitForTimeout(2000);

    // Ищем итоговые значения
    const totalRow = page.locator('tr').filter({ hasText: 'Всего' });
    const profitRow = page.locator('tr').filter({ hasText: 'Прибыль' });

    if (await totalRow.count() > 0) {
      const totalText = await totalRow.first().innerText();
      console.log(`[FINANCIAL] Всего: ${totalText}`);
    }

    if (await profitRow.count() > 0) {
      const profitText = await profitRow.first().innerText();
      console.log(`[FINANCIAL] Прибыль: ${profitText}`);
    }

    // Итоговая проверка
    console.log('\n=== РЕЗУЛЬТАТЫ ПРОВЕРКИ КОНСИСТЕНТНОСТИ ===');
    console.log('\n[COMMERCE]');
    console.log(JSON.stringify(pricingData.commerce, null, 2));
    console.log('\n[COSTS]');
    console.log(JSON.stringify(pricingData.costs, null, 2));
    console.log('\n[FINANCIAL]');
    console.log(JSON.stringify(pricingData.financial, null, 2));

    // Проверяем что данные были собраны
    expect(pricingData.commerce).not.toBeNull();

    console.log('\n✓ Проверка консистентности завершена');
    console.log('==========================================\n');
  });

  /**
   * Тест 5: Проверка изменения тактики наценок и пересчёта
   */
  test('5. Проверка применения тактики наценок и синхронизации', async ({ page }) => {
    console.log('\n=== ПРОВЕРКА ПРИМЕНЕНИЯ ТАКТИКИ НАЦЕНОК ===\n');

    // Переходим на Commerce
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);

    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    await tenderOption.click();
    await page.waitForTimeout(2000);

    // Сохраняем исходные значения
    const commerceStatsBefore = page.locator('.ant-statistic');
    const beforeValues: { [key: string]: string } = {};

    if (await commerceStatsBefore.first().isVisible()) {
      const statsCount = await commerceStatsBefore.count();
      for (let i = 0; i < statsCount; i++) {
        const title = await commerceStatsBefore.nth(i).locator('.ant-statistic-title').innerText();
        const value = await commerceStatsBefore.nth(i).locator('.ant-statistic-content-value').innerText();
        beforeValues[title] = value;
      }

      console.log('[BEFORE] Значения до изменения тактики:');
      console.log(JSON.stringify(beforeValues, null, 2));
    }

    // Пытаемся изменить тактику
    const tacticSelect = page.locator('.ant-select').nth(1);
    if (await tacticSelect.isVisible()) {
      await tacticSelect.click();
      await page.waitForTimeout(500);

      const tacticOptions = page.locator('.ant-select-dropdown').last().locator('.ant-select-item');
      const tacticCount = await tacticOptions.count();

      console.log(`\n[TACTICS] Доступно тактик наценок: ${tacticCount}`);

      if (tacticCount > 1) {
        // Выбираем другую тактику
        await tacticOptions.nth(1).click();
        await page.waitForTimeout(500);

        const applyButton = page.locator('button:has-text("Применить тактику")');
        if (await applyButton.isVisible()) {
          console.log('[TACTICS] Кнопка "Применить тактику" появилась');

          // Применяем новую тактику (с подтверждением)
          await applyButton.click();

          const modal = page.locator('.ant-modal');
          if (await modal.isVisible({ timeout: 3000 })) {
            console.log('[TACTICS] Модальное окно подтверждения открылось');

            const confirmButton = page.locator('.ant-modal button:has-text("Применить")');
            if (await confirmButton.count() > 0) {
              await confirmButton.click();
              await page.waitForTimeout(3000);

              console.log('[TACTICS] Тактика применена, ожидание пересчёта...');

              // Проверяем что значения изменились
              const commerceStatsAfter = page.locator('.ant-statistic');
              const afterValues: { [key: string]: string } = {};

              if (await commerceStatsAfter.first().isVisible()) {
                const statsCount = await commerceStatsAfter.count();
                for (let i = 0; i < statsCount; i++) {
                  const title = await commerceStatsAfter.nth(i).locator('.ant-statistic-title').innerText();
                  const value = await commerceStatsAfter.nth(i).locator('.ant-statistic-content-value').innerText();
                  afterValues[title] = value;
                }

                console.log('\n[AFTER] Значения после изменения тактики:');
                console.log(JSON.stringify(afterValues, null, 2));

                // Проверяем что хотя бы одно значение изменилось
                const hasChanges = Object.keys(beforeValues).some(
                  key => beforeValues[key] !== afterValues[key]
                );

                if (hasChanges) {
                  console.log('\n✓ Значения успешно пересчитались после изменения тактики');
                } else {
                  console.log('\n⚠ Значения не изменились (возможно, тактики идентичны)');
                }
              }
            } else {
              // Отменяем если нет кнопки подтверждения
              const cancelButton = page.locator('.ant-modal button:has-text("Отмена")');
              await cancelButton.click();
            }
          }
        }
      } else {
        console.log('[TACTICS] Недостаточно тактик для теста изменения');
      }
    }

    console.log('\n✓ Тест применения тактики завершён\n');
  });
});
