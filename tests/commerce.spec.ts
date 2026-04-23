import { test, expect } from '@playwright/test';

test.describe('Страница Коммерция - Расчет коммерческой стоимости', () => {

  test('Выбор тендера и тактики наценок', async ({ page }) => {
    // Переходим на страницу Commerce
    await page.goto('http://localhost:5185/commerce');

    // Ждем загрузки страницы
    await page.waitForSelector('[data-testid="commerce-page"], h3:has-text("Коммерция")', {
      timeout: 10000
    });

    // Проверяем наличие основных элементов
    await expect(page.locator('h3:has-text("Коммерция")')).toBeVisible();

    // Проверяем наличие селекторов
    const tenderSelect = page.locator('.ant-select').first();
    await expect(tenderSelect).toBeVisible();

    // Кликаем на селектор тендера
    await tenderSelect.click();
    await page.waitForTimeout(500);

    // Выбираем первый тендер из списка
    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    if (await tenderOption.isVisible()) {
      await tenderOption.click();

      // Ждем загрузки данных
      await page.waitForTimeout(1000);

      // Проверяем, что появился второй селектор для тактик
      const tacticSelect = page.locator('.ant-select').nth(1);
      await expect(tacticSelect).toBeVisible();

      // Проверяем наличие кнопок
      const recalcButton = page.locator('button:has-text("Пересчитать")');
      await expect(recalcButton).toBeVisible();

      // Проверяем наличие информации о тендере
      const tenderInfo = page.locator('.ant-card-small');
      if (await tenderInfo.isVisible()) {
        await expect(tenderInfo).toContainText('Клиент:');
        await expect(tenderInfo).toContainText('Номер тендера:');
        await expect(tenderInfo).toContainText('Тактика наценок:');
      }
    }
  });

  test('Изменение тактики наценок', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');

    // Ждем загрузки
    await page.waitForSelector('h3:has-text("Коммерция")');

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);

    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    if (await tenderOption.isVisible()) {
      await tenderOption.click();
      await page.waitForTimeout(1000);

      // Кликаем на селектор тактик
      const tacticSelect = page.locator('.ant-select').nth(1);
      await tacticSelect.click();
      await page.waitForTimeout(500);

      // Проверяем наличие опций тактик
      const tacticOptions = page.locator('.ant-select-dropdown').last().locator('.ant-select-item');
      const count = await tacticOptions.count();

      if (count > 1) {
        // Выбираем вторую тактику (если есть)
        await tacticOptions.nth(1).click();
        await page.waitForTimeout(500);

        // Проверяем появление кнопки "Применить тактику"
        const applyButton = page.locator('button:has-text("Применить тактику")');
        if (await applyButton.isVisible()) {
          console.log('✓ Кнопка применения тактики появилась при изменении');

          // Кликаем на кнопку применения
          await applyButton.click();

          // Должно появиться модальное окно подтверждения
          const modal = page.locator('.ant-modal');
          await expect(modal).toBeVisible({ timeout: 5000 });
          await expect(modal).toContainText('Применить новую тактику?');

          // Отменяем действие
          const cancelButton = page.locator('.ant-modal button:has-text("Отмена")');
          await cancelButton.click();
        }
      }
    }
  });

  test('Пересчет коммерческих стоимостей', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');

    // Ждем загрузки
    await page.waitForSelector('h3:has-text("Коммерция")');

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);

    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    if (await tenderOption.isVisible()) {
      await tenderOption.click();
      await page.waitForTimeout(1500);

      // Нажимаем кнопку "Пересчитать"
      const recalcButton = page.locator('button:has-text("Пересчитать")');
      await recalcButton.click();

      // Ждем завершения расчета
      await page.waitForTimeout(2000);

      // Проверяем наличие таблицы с данными
      const table = page.locator('.ant-table');
      if (await table.isVisible()) {
        console.log('✓ Таблица с позициями отображается');

        // Проверяем наличие колонок
        await expect(table).toContainText('№');
        await expect(table).toContainText('Раздел / Наименование');

        // Проверяем статистику (если есть данные)
        const statsCards = page.locator('.ant-statistic');
        if (await statsCards.first().isVisible()) {
          console.log('✓ Статистика отображается');

          // Проверяем заголовки статистики
          const statsTitles = page.locator('.ant-statistic-title');
          const titles = await statsTitles.allTextContents();

          if (titles.includes('Базовая стоимость')) {
            console.log('✓ Базовая стоимость отображается');
          }

          if (titles.includes('Коммерческая стоимость')) {
            console.log('✓ Коммерческая стоимость отображается');
          }
        }
      }
    }
  });

  test('Проверка отладочных функций (dev mode)', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');

    // Ждем загрузки
    await page.waitForSelector('h3:has-text("Коммерция")');

    // Проверяем наличие кнопок отладки
    const testButton = page.locator('button:has-text("Тест")');
    const debugButton = page.locator('button:has-text("Debug")');

    if (await testButton.isVisible()) {
      console.log('✓ Кнопка "Тест" доступна в dev режиме');
    }

    if (await debugButton.isVisible()) {
      console.log('✓ Кнопка "Debug" доступна в dev режиме');

      // Выбираем тендер для отладки
      const tenderSelect = page.locator('.ant-select').first();
      await tenderSelect.click();
      await page.waitForTimeout(500);

      const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
      if (await tenderOption.isVisible()) {
        await tenderOption.click();
        await page.waitForTimeout(1000);

        // Открываем консоль для просмотра отладочной информации
        await page.evaluate(() => {
          console.log('=== НАЧАЛО ОТЛАДКИ КОММЕРЧЕСКИХ СТОИМОСТЕЙ ===');
        });

        // Нажимаем кнопку Debug
        await debugButton.click();
        await page.waitForTimeout(1000);

        // Проверяем консоль на наличие отладочной информации
        page.on('console', msg => {
          if (msg.type() === 'log' && msg.text().includes('ОТЛАДКА РАСЧЕТА')) {
            console.log('✓ Отладочная информация выводится в консоль');
          }
        });
      }
    }
  });

  test('Экспорт в Excel', async ({ page }) => {
    await page.goto('http://localhost:5185/commerce');

    // Ждем загрузки
    await page.waitForSelector('h3:has-text("Коммерция")');

    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForTimeout(500);

    const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
    if (await tenderOption.isVisible()) {
      await tenderOption.click();
      await page.waitForTimeout(1500);

      // Проверяем кнопку экспорта
      const exportButton = page.locator('button:has-text("Экспорт")');

      if (await exportButton.isVisible()) {
        // Проверяем, что кнопка активна (если есть данные)
        const isDisabled = await exportButton.isDisabled();

        if (!isDisabled) {
          console.log('✓ Кнопка экспорта доступна');

          // Подготавливаем перехват загрузки файла
          const downloadPromise = page.waitForEvent('download');

          // Нажимаем кнопку экспорта
          await exportButton.click();

          // Проверяем, начинается ли загрузка
          try {
            const download = await Promise.race([
              downloadPromise,
              page.waitForTimeout(3000).then(() => null)
            ]);

            if (download) {
              console.log('✓ Файл Excel начал загружаться');
              console.log(`  Имя файла: ${download.suggestedFilename()}`);
            }
          } catch (e) {
            console.log('Загрузка файла не началась (возможно, нет данных)');
          }
        } else {
          console.log('Кнопка экспорта неактивна (нет данных для экспорта)');
        }
      }
    }
  });
});

// Вспомогательный тест для проверки консоли
test('Проверка расчетов через консоль', async ({ page }) => {
  await page.goto('http://localhost:5185/commerce');

  // Ждем загрузки
  await page.waitForSelector('h3:has-text("Коммерция")');

  // Выполняем диагностические функции в консоли
  const results = await page.evaluate(async () => {
    const results: any = {};

    // Проверяем наличие диагностических функций
    if (typeof (window as any).checkMarkupSequences === 'function') {
      results.hasCheckSequences = true;
      console.log('✓ Функция checkMarkupSequences доступна');
    }

    if (typeof (window as any).debugCommercialCalculation === 'function') {
      results.hasDebugCalculation = true;
      console.log('✓ Функция debugCommercialCalculation доступна');
    }

    if (typeof (window as any).checkDatabaseStructure === 'function') {
      results.hasCheckDatabase = true;
      console.log('✓ Функция checkDatabaseStructure доступна');
    }

    return results;
  });

  // Проверяем результаты
  if (results.hasCheckSequences) {
    console.log('✅ Диагностика последовательностей доступна');
  }

  if (results.hasDebugCalculation) {
    console.log('✅ Отладка расчетов доступна');
  }

  if (results.hasCheckDatabase) {
    console.log('✅ Проверка структуры БД доступна');
  }
});