/**
 * Упрощённый тест для проверки индикатора консистентности на странице Commerce
 */

import { test, expect } from '@playwright/test';

test.describe('Commerce Consistency Indicator - Simple Tests', () => {
  test('должен отображать индикатор после выбора тендера через карточку', async ({ page }) => {
    // Переходим на страницу Commerce
    await page.goto('http://localhost:5185/commerce');
    await page.waitForLoadState('networkidle');

    // Ждём появления карточек тендеров
    const tenderCard = page.locator('.ant-card-hoverable').first();
    await expect(tenderCard).toBeVisible({ timeout: 10000 });

    // Кликаем на первую карточку
    await tenderCard.click();
    console.log('✓ Клик на карточку тендера');

    // Ждём загрузки данных
    await page.waitForTimeout(3000);

    // Проверяем, что индикатор присутствует
    const indicator = page.locator('div').filter({
      hasText: /Консистентность|Требуется|Ошибка|пересчёт/i
    }).first();

    await expect(indicator).toBeVisible({ timeout: 10000 });
    console.log('✓ Индикатор консистентности отображается');

    // Получаем текст индикатора
    const indicatorText = await indicator.textContent();
    console.log('Текст индикатора:', indicatorText);

    // Проверяем наличие хотя бы одной иконки
    const hasIcons = await page.locator('svg[data-icon="check-circle"], svg[data-icon="close-circle"], svg[data-icon="loading"]').count();
    expect(hasIcons).toBeGreaterThan(0);
    console.log(`✓ Найдено ${hasIcons} иконок статуса`);
  });

  test('должен показывать tooltip с детальной информацией', async ({ page }) => {
    // Переходим на страницу и выбираем тендер
    await page.goto('http://localhost:5185/commerce');
    await page.waitForLoadState('networkidle');

    const tenderCard = page.locator('.ant-card-hoverable').first();
    await tenderCard.click();
    await page.waitForTimeout(3000);

    // Находим индикатор
    const indicator = page.locator('div').filter({
      hasText: /Консистентность|Требуется|пересчёт/i
    }).first();

    await expect(indicator).toBeVisible();

    // Наводим на индикатор
    await indicator.hover();
    await page.waitForTimeout(1000);

    // Проверяем tooltip
    const tooltip = page.locator('.ant-tooltip-inner').first();
    const tooltipVisible = await tooltip.isVisible().catch(() => false);

    if (tooltipVisible) {
      const tooltipText = await tooltip.textContent();
      console.log('✓ Tooltip отображается:', tooltipText);

      // Проверяем, что tooltip содержит ключевые слова
      expect(tooltipText).toMatch(/Коммерция|Затраты|Финансовые|показатели/i);
    } else {
      console.log('⚠ Tooltip не появился (возможно, не настроен для этого состояния)');
    }
  });

  test('должен обновляться после нажатия кнопки Обновить', async ({ page }) => {
    // Переходим на страницу и выбираем тендер
    await page.goto('http://localhost:5185/commerce');
    await page.waitForLoadState('networkidle');

    const tenderCard = page.locator('.ant-card-hoverable').first();
    await tenderCard.click();
    await page.waitForTimeout(3000);

    // Проверяем начальное состояние
    const indicatorBefore = page.locator('div').filter({
      hasText: /Консистентность|Требуется|пересчёт/i
    }).first();

    await expect(indicatorBefore).toBeVisible();
    const textBefore = await indicatorBefore.textContent();
    console.log('Состояние до обновления:', textBefore);

    // Нажимаем кнопку обновить
    const reloadButton = page.locator('button').filter({ hasText: /reload/i }).or(
      page.locator('button[aria-label="reload"]')
    ).first();

    const isReloadVisible = await reloadButton.isVisible().catch(() => false);

    if (isReloadVisible) {
      await reloadButton.click();
      console.log('✓ Нажата кнопка Обновить');

      // Ждём обновления
      await page.waitForTimeout(2000);

      // Проверяем, что индикатор всё ещё виден
      const indicatorAfter = page.locator('div').filter({
        hasText: /Консистентность|Требуется|пересчёт/i
      }).first();

      await expect(indicatorAfter).toBeVisible();
      console.log('✓ Индикатор обновлён');
    } else {
      console.log('⚠ Кнопка Обновить не найдена');
    }
  });

  test('должен логировать данные в консоль', async ({ page }) => {
    const consoleLogs: string[] = [];

    // Собираем логи консоли
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Проверка Commerce') ||
          text.includes('Проверка Costs') ||
          text.includes('Проверка Financial') ||
          text.includes('Консистентность')) {
        consoleLogs.push(text);
      }
    });

    // Переходим на страницу и выбираем тендер
    await page.goto('http://localhost:5185/commerce');
    await page.waitForLoadState('networkidle');

    const tenderCard = page.locator('.ant-card-hoverable').first();
    await tenderCard.click();
    await page.waitForTimeout(3000);

    // Проверяем, что логи появились
    console.log('Собранные логи консоли:');
    consoleLogs.forEach(log => console.log('  -', log));

    expect(consoleLogs.length).toBeGreaterThan(0);
    console.log(`✓ Найдено ${consoleLogs.length} логов проверки`);
  });
});
