import { test, expect } from '@playwright/test';

test.describe('Производительность страницы Коммерция', () => {
  test('Время загрузки страницы Коммерция', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('http://localhost:5185/commerce');

    // Ожидаем загрузку селектора тендера
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Время загрузки страницы Коммерция: ${loadTime}ms`);

    // Проверка, что загрузка заняла менее 3 секунд
    expect(loadTime).toBeLessThan(3000);
  });

  test('Время выбора тендера и загрузки коммерческих данных', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');

    // Ждём селектор тендера
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Открываем селект тендера
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();

    // Ждём опции
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });

    // Выбираем первый тендер
    const startTime = Date.now();
    await page.click('.ant-select-item-option:first-child');

    // Ждём загрузку таблицы с коммерческими данными
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Время загрузки коммерческих данных: ${loadTime}ms`);

    // Проверка, что загрузка заняла менее 8 секунд
    expect(loadTime).toBeLessThan(8000);

    // Проверяем, что данные загрузились
    const rows = await page.locator('.ant-table-tbody tr').count();
    console.log(`📊 Загружено позиций: ${rows}`);
    expect(rows).toBeGreaterThan(0);
  });

  test('Проверка расчёта коммерческих стоимостей', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Проверяем наличие колонок с ценами
    const hasPricePerUnitMaterial = await page.locator('th:has-text("Цена за единицу материалов")').count();
    const hasPricePerUnitWork = await page.locator('th:has-text("Цена за единицу работ")').count();

    console.log(`✅ Колонка "Цена за единицу материалов": ${hasPricePerUnitMaterial > 0 ? 'Найдена' : 'Не найдена'}`);
    console.log(`✅ Колонка "Цена за единицу работ": ${hasPricePerUnitWork > 0 ? 'Найдена' : 'Не найдена'}`);

    expect(hasPricePerUnitMaterial).toBeGreaterThan(0);
    expect(hasPricePerUnitWork).toBeGreaterThan(0);

    // Проверяем, что есть данные в ячейках
    const firstRowMaterialPrice = await page.locator('.ant-table-tbody tr:first-child td:has-text("₽")').count();
    expect(firstRowMaterialPrice).toBeGreaterThan(0);
  });

  test('Проверка количества запросов к БД при загрузке коммерции', async ({ page }) => {
    const requests: string[] = [];

    // Отслеживаем все запросы к Supabase
    page.on('request', request => {
      if (request.url().includes('supabase')) {
        requests.push(request.url());
      }
    });

    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Ждём завершения всех запросов
    await page.waitForTimeout(3000);

    console.log(`🌐 Количество запросов к Supabase: ${requests.length}`);

    // Группируем запросы по таблицам
    const requestsByTable: Record<string, number> = {};
    requests.forEach(url => {
      const match = url.match(/\/rest\/v1\/([^?]+)/);
      if (match) {
        const table = match[1];
        requestsByTable[table] = (requestsByTable[table] || 0) + 1;
      }
    });

    console.log('Запросы по таблицам:');
    Object.entries(requestsByTable).forEach(([table, count]) => {
      console.log(`  - ${table}: ${count} запросов`);
    });

    // Анализируем проблемные запросы
    const boqItemsRequests = requests.filter(r => r.includes('boq_items'));
    if (boqItemsRequests.length > 50) {
      console.warn(`⚠️  ВНИМАНИЕ: Слишком много запросов к boq_items (${boqItemsRequests.length})!`);
      console.warn('   Рекомендуется оптимизировать загрузку данных (batch loading или JOIN)');
    }
  });

  test('Проверка применения тактики наценок', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Ждём загрузку тактик
    await page.waitForTimeout(1000);

    // Ищем кнопку "Пересчитать коммерцию"
    const recalculateButton = page.locator('button:has-text("Пересчитать")');
    const hasRecalculateButton = await recalculateButton.count() > 0;

    if (hasRecalculateButton) {
      console.log('✅ Найдена кнопка пересчёта коммерции');

      // Измеряем время пересчёта
      const startTime = Date.now();
      await recalculateButton.click();

      // Ждём завершения пересчёта (спиннер должен исчезнуть)
      await page.waitForSelector('.ant-spin', { state: 'hidden', timeout: 30000 });

      const recalcTime = Date.now() - startTime;
      console.log(`⏱️  Время пересчёта коммерции: ${recalcTime}ms`);

      // Пересчёт должен занять менее 30 секунд
      expect(recalcTime).toBeLessThan(30000);
    } else {
      console.log('ℹ️  Кнопка пересчёта не найдена на странице');
    }
  });

  test('Проверка итоговых статистик', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Проверяем наличие статистик
    const statistics = await page.locator('.ant-statistic').count();
    console.log(`📈 Найдено статистик: ${statistics}`);

    // Должна быть хотя бы одна статистика
    expect(statistics).toBeGreaterThan(0);

    // Проверяем, что статистики показывают числа
    const statisticValues = await page.locator('.ant-statistic-content-value').allTextContents();
    console.log('Значения статистик:', statisticValues);

    // Все значения должны содержать цифры или символ валюты
    statisticValues.forEach(value => {
      expect(value).toMatch(/[\d₽%,\s]/);
    });
  });
});
