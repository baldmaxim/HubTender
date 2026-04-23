import { test, expect } from '@playwright/test';

test.describe('Производительность страницы Позиции заказчика', () => {
  test('Время загрузки страницы позиций заказчика', async ({ page }) => {
    // Переход на страницу позиций
    const startTime = Date.now();
    await page.goto('http://localhost:5185/positions');

    // Ожидаем загрузку селектора тендера
    await page.waitForSelector('input[placeholder*="Выберите тендер"]', { timeout: 10000 });

    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Время загрузки страницы: ${loadTime}ms`);

    // Проверка, что загрузка заняла менее 3 секунд
    expect(loadTime).toBeLessThan(3000);
  });

  test('Время выбора тендера и загрузки позиций', async ({ page }) => {
    await page.goto('http://localhost:5185/positions');

    // Ждём селектор тендера
    await page.waitForSelector('input[placeholder*="Выберите тендер"]', { timeout: 10000 });

    // Открываем селект
    await page.click('input[placeholder*="Выберите тендер"]');

    // Ждём опции
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });

    // Выбираем первый тендер
    const startTime = Date.now();
    await page.click('.ant-select-item-option:first-child');

    // Ждём загрузку таблицы с позициями
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Время загрузки позиций после выбора тендера: ${loadTime}ms`);

    // Проверка, что загрузка заняла менее 5 секунд
    expect(loadTime).toBeLessThan(5000);

    // Проверяем, что позиции загрузились
    const rows = await page.locator('.ant-table-tbody tr').count();
    console.log(`📊 Загружено позиций: ${rows}`);
    expect(rows).toBeGreaterThan(0);
  });

  test('Проверка количества запросов к БД', async ({ page }) => {
    const requests: string[] = [];

    // Отслеживаем все запросы к Supabase
    page.on('request', request => {
      if (request.url().includes('supabase')) {
        requests.push(request.url());
      }
    });

    await page.goto('http://localhost:5185/positions');
    await page.waitForSelector('input[placeholder*="Выберите тендер"]', { timeout: 10000 });

    // Выбираем тендер
    await page.click('input[placeholder*="Выберите тендер"]');
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Ждём завершения всех запросов
    await page.waitForTimeout(2000);

    console.log(`🌐 Количество запросов к Supabase: ${requests.length}`);
    console.log('Запросы:', requests.map(r => {
      const url = new URL(r);
      return url.pathname + url.search;
    }).join('\n'));

    // Должно быть разумное количество запросов (не более 10)
    expect(requests.length).toBeLessThan(10);
  });

  test('Тест прокрутки и рендеринга большой таблицы', async ({ page }) => {
    await page.goto('http://localhost:5185/positions');
    await page.waitForSelector('input[placeholder*="Выберите тендер"]', { timeout: 10000 });

    // Выбираем тендер
    await page.click('input[placeholder*="Выберите тендер"]');
    await page.waitForSelector('.ant-select-item-option', { timeout: 5000 });
    await page.click('.ant-select-item-option:first-child');
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });

    // Измеряем время прокрутки
    const startTime = Date.now();

    // Прокручиваем таблицу вниз
    await page.evaluate(() => {
      const scrollContainer = document.querySelector('.ant-table-body');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });

    await page.waitForTimeout(500);

    const scrollTime = Date.now() - startTime;
    console.log(`⏱️  Время прокрутки таблицы: ${scrollTime}ms`);

    // Прокрутка должна быть плавной (менее 1 секунды)
    expect(scrollTime).toBeLessThan(1000);
  });
});
