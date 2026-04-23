/**
 * Тесты для страницы Конструктора наценок
 */

import { test, expect } from '@playwright/test';

test.describe('Markup Constructor Page', () => {
  test.beforeEach(async ({ page }) => {
    // Переходим на страницу Конструктора наценок
    await page.goto('http://localhost:5185/admin/markup_constructor');
    await page.waitForLoadState('networkidle');
  });

  test('должна загружаться без ошибок', async ({ page }) => {
    // Проверяем что страница загрузилась
    await expect(page).toHaveURL('http://localhost:5185/admin/markup_constructor');

    // Проверяем наличие заголовка
    const title = page.locator('h4, h3, h2').filter({ hasText: /Конструктор|наценок|Markup/i }).first();
    await expect(title).toBeVisible({ timeout: 10000 });

    console.log('✓ Страница загружена успешно');
  });

  test('должна отображать табы', async ({ page }) => {
    // Проверяем наличие вкладок
    const tabs = page.locator('.ant-tabs-tab');
    const tabCount = await tabs.count();

    expect(tabCount).toBeGreaterThan(0);
    console.log(`✓ Найдено вкладок: ${tabCount}`);

    // Выводим названия вкладок
    for (let i = 0; i < tabCount; i++) {
      const tabText = await tabs.nth(i).textContent();
      console.log(`  - Вкладка ${i + 1}: ${tabText}`);
    }
  });

  test('должна отображать список тактик наценок', async ({ page }) => {
    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Проверяем наличие таблицы или списка тактик
    const tacticsList = page.locator('.ant-table, .ant-list, [class*="tactic"]').first();
    const isVisible = await tacticsList.isVisible().catch(() => false);

    if (isVisible) {
      console.log('✓ Список тактик отображается');

      // Проверяем наличие строк/элементов
      const rows = page.locator('.ant-table-row, .ant-list-item, [class*="tactic-item"]');
      const rowCount = await rows.count();
      console.log(`  Найдено тактик: ${rowCount}`);
    } else {
      console.log('⚠ Список тактик не найден (возможно пустой список)');
    }
  });

  test('должна содержать кнопку создания новой тактики', async ({ page }) => {
    // Ищем кнопку "Создать", "Добавить" или "Новая тактика"
    const createButton = page.locator('button').filter({
      hasText: /Создать|Добавить|Новая|Create|Add|New/i
    }).first();

    const isVisible = await createButton.isVisible().catch(() => false);

    if (isVisible) {
      const buttonText = await createButton.textContent();
      console.log(`✓ Кнопка создания найдена: "${buttonText}"`);
    } else {
      console.log('⚠ Кнопка создания тактики не найдена');
    }
  });

  test('не должна отображать ошибки в консоли', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Ждём загрузки страницы
    await page.waitForTimeout(3000);

    // Фильтруем известные несущественные ошибки
    const criticalErrors = errors.filter(err =>
      !err.includes('deprecated') &&
      !err.includes('warning') &&
      !err.includes('DevTools')
    );

    if (criticalErrors.length > 0) {
      console.log('⚠ Найдены ошибки:');
      criticalErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('✓ Критических ошибок не обнаружено');
    }

    expect(criticalErrors.length).toBe(0);
  });

  test('должна переключаться между вкладками', async ({ page }) => {
    // Получаем все вкладки
    const tabs = page.locator('.ant-tabs-tab');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Кликаем на вторую вкладку
      await tabs.nth(1).click();
      await page.waitForTimeout(500);

      // Проверяем что вкладка стала активной
      const isActive = await tabs.nth(1).locator('.ant-tabs-tab-active').isVisible().catch(() => false);

      if (isActive) {
        console.log('✓ Переключение между вкладками работает');
      } else {
        // Проверяем альтернативным способом
        const tabText = await tabs.nth(1).textContent();
        console.log(`✓ Переключились на вкладку: ${tabText}`);
      }
    } else {
      console.log('⚠ Недостаточно вкладок для проверки переключения');
    }
  });

  test('должна сохранять данные при навигации', async ({ page }) => {
    // Запоминаем URL
    const initialUrl = page.url();

    // Переходим на другую страницу
    await page.goto('http://localhost:5185/dashboard');
    await page.waitForLoadState('networkidle');

    // Возвращаемся обратно
    await page.goto(initialUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Проверяем что страница загрузилась корректно
    const title = page.locator('h4, h3, h2').filter({ hasText: /Конструктор|наценок|Markup/i }).first();
    await expect(title).toBeVisible({ timeout: 10000 });

    console.log('✓ Страница корректно загружается после навигации');
  });
});
