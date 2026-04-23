import { test, expect } from '@playwright/test';

test.describe('Financial Indicators - Category Breakdown', () => {
  test('should display breakdown table when clicking on pie chart segment', async ({ page }) => {
    // Переходим на страницу финансовых показателей
    await page.goto('http://localhost:5185/financial-indicators');

    // Ждем загрузки страницы
    await page.waitForLoadState('networkidle');

    // Проверяем, что есть селект для выбора тендера
    const tenderSelect = page.locator('input[placeholder="Выберите тендер"]').first();
    await expect(tenderSelect).toBeVisible();

    // Кликаем на селект
    await tenderSelect.click();

    // Ждем появления опций
    await page.waitForTimeout(500);

    // Выбираем первый тендер из списка
    const firstOption = page.locator('.ant-select-item').first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Ждем загрузки данных
    await page.waitForTimeout(1000);

    // Проверяем, что появился селект версии
    const versionSelect = page.locator('input[placeholder="Выберите версию"]').first();
    await expect(versionSelect).toBeVisible();

    // Кликаем на селект версии
    await versionSelect.click();
    await page.waitForTimeout(500);

    // Выбираем первую версию
    const firstVersion = page.locator('.ant-select-item').first();
    await firstVersion.click();

    // Ждем загрузки данных тендера
    await page.waitForTimeout(2000);

    // Проверяем, что круговая диаграмма отображается
    const pieChart = page.locator('canvas').first();
    await expect(pieChart).toBeVisible();

    // Получаем информацию о canvas
    const canvasBox = await pieChart.boundingBox();
    if (!canvasBox) {
      throw new Error('Canvas not found');
    }

    // Кликаем по центру круговой диаграммы (где должен быть один из сегментов)
    const centerX = canvasBox.x + canvasBox.width / 2;
    const centerY = canvasBox.y + canvasBox.height / 3; // Немного выше центра, чтобы попасть в сегмент

    await page.mouse.click(centerX, centerY);

    // Ждем появления таблицы детализации
    await page.waitForTimeout(1000);

    // Проверяем, что появилась карточка с детализацией
    const detailCard = page.locator('div:has-text("Детализация по категориям затрат")').first();
    await expect(detailCard).toBeVisible();

    // Проверяем наличие таблицы
    const table = page.locator('table').last();
    await expect(table).toBeVisible();

    // Проверяем наличие заголовков колонок
    await expect(page.locator('th:has-text("Категория затрат")')).toBeVisible();
    await expect(page.locator('th:has-text("Вид затрат")')).toBeVisible();
    await expect(page.locator('th:has-text("Локализация")')).toBeVisible();
    await expect(page.locator('th:has-text("Работы (руб.)")')).toBeVisible();
    await expect(page.locator('th:has-text("Материалы (руб.)")')).toBeVisible();
    await expect(page.locator('th:has-text("Итого (руб.)")')).toBeVisible();

    // Проверяем, что есть хотя бы одна строка данных
    const tableRows = table.locator('tbody tr').filter({ hasNotText: 'ИТОГО' });
    const rowCount = await tableRows.count();

    console.log('Number of data rows:', rowCount);

    if (rowCount > 0) {
      // Проверяем первую строку
      const firstRow = tableRows.first();
      await expect(firstRow).toBeVisible();

      // Проверяем, что в строке есть данные
      const cells = firstRow.locator('td');
      const cellCount = await cells.count();
      console.log('Number of cells in first row:', cellCount);

      expect(cellCount).toBeGreaterThan(0);
    }

    // Проверяем наличие итоговой строки
    const summaryRow = table.locator('tr:has-text("ИТОГО:")');
    await expect(summaryRow).toBeVisible();

    // Скриншот для визуальной проверки
    await page.screenshot({ path: 'tests/screenshots/financial-breakdown.png', fullPage: true });
  });

  test('should show console logs for debugging', async ({ page }) => {
    const logs: string[] = [];
    const errors: string[] = [];

    // Собираем console.log
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      console.log('BROWSER LOG:', text);
    });

    // Собираем ошибки
    page.on('pageerror', error => {
      errors.push(error.message);
      console.error('BROWSER ERROR:', error.message);
    });

    // Переходим на страницу
    await page.goto('http://localhost:5185/financial-indicators');
    await page.waitForLoadState('networkidle');

    // Выбираем тендер
    const tenderSelect = page.locator('input[placeholder="Выберите тендер"]').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);
    const firstOption = page.locator('.ant-select-item').first();
    await firstOption.click();
    await page.waitForTimeout(1000);

    // Выбираем версию
    const versionSelect = page.locator('input[placeholder="Выберите версию"]').first();
    await versionSelect.click();
    await page.waitForTimeout(500);
    const firstVersion = page.locator('.ant-select-item').first();
    await firstVersion.click();
    await page.waitForTimeout(2000);

    // Кликаем по диаграмме
    const pieChart = page.locator('canvas').first();
    const canvasBox = await pieChart.boundingBox();
    if (canvasBox) {
      const centerX = canvasBox.x + canvasBox.width / 2;
      const centerY = canvasBox.y + canvasBox.height / 3;
      await page.mouse.click(centerX, centerY);
    }

    // Ждем результата
    await page.waitForTimeout(2000);

    // Выводим все логи
    console.log('\n=== ALL LOGS ===');
    logs.forEach(log => console.log(log));

    console.log('\n=== ALL ERRORS ===');
    errors.forEach(error => console.log(error));

    // Проверяем наличие ошибок
    expect(errors.length).toBe(0);
  });
});
