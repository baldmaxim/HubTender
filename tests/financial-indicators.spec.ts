import { test, expect } from '@playwright/test';

test.describe('Финансовые показатели - проверка расчётов', () => {
  test.beforeEach(async ({ page }) => {
    // Переход на страницу финансовых показателей
    await page.goto('http://localhost:5185/financial-indicators');

    // Ожидание загрузки страницы
    await page.waitForSelector('text=Финансовые показатели', { timeout: 10000 });
  });

  test('Проверка загрузки страницы и наличия основных элементов', async ({ page }) => {
    // Проверяем заголовок страницы
    await expect(page.locator('text=Финансовые показатели')).toBeVisible();

    // Проверяем наличие селектора тендера
    const tenderSelect = page.locator('.ant-select').first();
    await expect(tenderSelect).toBeVisible();

    // Проверяем наличие таблицы
    await expect(page.locator('.ant-table')).toBeVisible();
  });

  test('Проверка отображения строки "0,6 к (Раб+СМ)"', async ({ page }) => {
    // Выбираем любой тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();

    // Ждём появления выпадающего списка
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    // Выбираем первый тендер в списке
    const firstOption = page.locator('.ant-select-item').first();
    await firstOption.click();

    // Ждём обновления таблицы
    await page.waitForTimeout(2000);

    // Проверяем наличие строки "0,6 к (Раб+СМ)"
    const coefficient06Row = page.locator('text=0,6 к (Раб+СМ)');
    await expect(coefficient06Row).toBeVisible();

    // Получаем значения из строки
    const rowElement = page.locator('tr').filter({ hasText: '0,6 к (Раб+СМ)' });
    await expect(rowElement).toBeVisible();
  });

  test('Проверка console логов для параметра 0,6к', async ({ page }) => {
    const consoleLogs: string[] = [];

    // Перехватываем console.log
    page.on('console', msg => {
      if (msg.type() === 'log') {
        consoleLogs.push(msg.text());
      }
    });

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const firstOption = page.locator('.ant-select-item').first();
    await firstOption.click();

    // Ждём появления логов
    await page.waitForTimeout(2000);

    // Проверяем наличие debug логов
    const hasDebugLog = consoleLogs.some(log => log.includes('DEBUG 0,6к Parameter'));
    expect(hasDebugLog).toBeTruthy();

    // Выводим все логи в консоль теста
    console.log('\n=== Console Logs ===');
    consoleLogs.forEach(log => {
      if (log.includes('DEBUG') || log.includes('0,6') || log.includes('markup parameters')) {
        console.log(log);
      }
    });
    console.log('===================\n');
  });

  test('Проверка наличия значений в строке 0,6к', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const firstOption = page.locator('.ant-select-item').first();
    await firstOption.click();

    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Находим строку 0,6к
    const coefficient06Row = page.locator('tr').filter({ hasText: '0,6 к (Раб+СМ)' });
    await expect(coefficient06Row).toBeVisible();

    // Получаем все ячейки строки
    const cells = coefficient06Row.locator('td');
    const cellCount = await cells.count();

    console.log(`\nСтрока "0,6 к (Раб+СМ)" имеет ${cellCount} ячеек`);

    // Проверяем содержимое каждой ячейки
    for (let i = 0; i < cellCount; i++) {
      const cellText = await cells.nth(i).innerText();
      console.log(`Ячейка ${i}: "${cellText}"`);
    }

    // Проверяем, что есть хотя бы одна ячейка с числовым значением (не пустая и не "0")
    let hasNumericValue = false;
    for (let i = 0; i < cellCount; i++) {
      const cellText = await cells.nth(i).innerText();
      const trimmedText = cellText.trim();

      if (trimmedText && trimmedText !== '0' && trimmedText !== '0.00' && !trimmedText.includes('0,6 к')) {
        // Проверяем, содержит ли строка число
        if (/\d+/.test(trimmedText)) {
          hasNumericValue = true;
          console.log(`\nНайдено числовое значение в ячейке ${i}: ${trimmedText}`);
          break;
        }
      }
    }

    if (!hasNumericValue) {
      console.log('\n⚠️ ПРОБЛЕМА: В строке "0,6 к (Раб+СМ)" нет числовых значений!');
    }
  });

  test('Детальный анализ данных таблицы', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const firstOption = page.locator('.ant-select-item').first();
    const tenderName = await firstOption.innerText();
    console.log(`\nВыбран тендер: ${tenderName}`);

    await firstOption.click();
    await page.waitForTimeout(2000);

    // Получаем все строки таблицы
    const rows = page.locator('.ant-table-tbody tr');
    const rowCount = await rows.count();

    console.log(`\nВсего строк в таблице: ${rowCount}`);
    console.log('\n=== Содержимое таблицы ===');

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const cells = row.locator('td');
      const cellTexts: string[] = [];

      const cellCount = await cells.count();
      for (let j = 0; j < cellCount; j++) {
        const cellText = await cells.nth(j).innerText();
        cellTexts.push(cellText.trim());
      }

      const rowText = cellTexts.join(' | ');
      console.log(`Строка ${i + 1}: ${rowText}`);

      // Особое внимание строке с 0,6к
      if (rowText.includes('0,6')) {
        console.log(`\n>>> НАЙДЕНА СТРОКА 0,6к (строка ${i + 1}): ${rowText}`);
      }
    }

    console.log('=========================\n');
  });

  test('Проверка структуры данных через evaluate', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown', { timeout: 5000 });

    const firstOption = page.locator('.ant-select-item').first();
    await firstOption.click();
    await page.waitForTimeout(2000);

    // Проверяем данные в React component через console logs
    const logs = await page.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        const collectedLogs: string[] = [];
        const originalLog = console.log;

        console.log = (...args) => {
          const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' ');
          collectedLogs.push(message);
          originalLog(...args);
        };

        // Ждём немного для сбора логов
        setTimeout(() => {
          console.log = originalLog;
          resolve(collectedLogs);
        }, 1000);
      });
    });

    console.log('\n=== Собранные логи из браузера ===');
    logs.forEach(log => {
      if (log.includes('0,6') || log.includes('markup parameters') || log.includes('DEBUG')) {
        console.log(log);
      }
    });
    console.log('==================================\n');
  });
});
