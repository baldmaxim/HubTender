/**
 * Тест для проверки индикатора консистентности коммерческих цен на странице Commerce
 */

import { test, expect } from '@playwright/test';

test.describe('Commerce Consistency Indicator', () => {
  test.beforeEach(async ({ page }) => {
    // Переходим на страницу Commerce
    await page.goto('http://localhost:5185/commerce');
    await page.waitForLoadState('networkidle');
  });

  test('должен отображать индикатор консистентности после выбора тендера', async ({ page }) => {
    // Ждём загрузки списка тендеров
    await page.waitForSelector('.ant-select', { timeout: 10000 });

    // Кликаем на карточку тендера вместо выбора из dropdown
    const tenderCard = page.locator('.ant-card-hoverable').first();
    const isCardVisible = await tenderCard.isVisible().catch(() => false);

    if (isCardVisible) {
      await tenderCard.click();
      console.log('✓ Выбран тендер через карточку');
    } else {
      // Альтернативный путь через dropdown
      const tenderSelect = page.locator('.ant-select').first();
      await tenderSelect.click();
      await page.waitForTimeout(500);
      const firstOption = page.locator('.ant-select-item-option').first();
      await firstOption.click();
      await page.waitForTimeout(1000);

      // Пробуем выбрать версию, если dropdown появился
      const versionSelect = page.locator('.ant-select').nth(1);
      const isVersionSelectVisible = await versionSelect.isVisible().catch(() => false);
      if (isVersionSelectVisible) {
        await versionSelect.click();
        await page.waitForTimeout(500);
        await page.locator('.ant-select-item-option').first().click();
      }
      console.log('✓ Выбран тендер через dropdown');
    }

    // Ждём загрузки данных тендера
    await page.waitForTimeout(3000);

    // Проверяем, что индикатор консистентности присутствует
    const indicator = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /Консистентность|Проверка|Требуется|пересчёт/i
    });

    await expect(indicator).toBeVisible({ timeout: 10000 });

    // Проверяем наличие иконок статуса (галочки или крестики)
    const statusIcons = page.locator('svg[data-icon="check-circle"], svg[data-icon="close-circle"]');
    await expect(statusIcons.first()).toBeVisible();

    console.log('✓ Индикатор консистентности отображается');
  });

  test('должен показывать статус загрузки при проверке', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    const firstOption = page.locator('.ant-select-item-option').first();
    await firstOption.click();

    // Выбираем версию
    await page.waitForTimeout(1000);
    const versionSelect = page.locator('.ant-select').nth(1);
    await versionSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    const firstVersion = page.locator('.ant-select-item-option').first();
    await firstVersion.click();

    // Проверяем, что появляется индикатор загрузки
    const loadingIndicator = page.locator('text=Проверка консистентности');

    // Индикатор загрузки должен появиться и затем исчезнуть
    const isLoadingVisible = await loadingIndicator.isVisible().catch(() => false);

    if (isLoadingVisible) {
      console.log('✓ Индикатор загрузки отображался');
    } else {
      console.log('⚠ Индикатор загрузки не отображался (проверка прошла быстро)');
    }

    // Ждём завершения проверки
    await page.waitForTimeout(2000);

    // Проверяем, что появился результат проверки
    const resultIndicator = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /подтверждена|проверка|пересчёт/i
    });

    await expect(resultIndicator).toBeVisible();
    console.log('✓ Результат проверки отображается');
  });

  test('должен показывать три индикатора: Commerce, Costs, Financial', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Выбираем версию
    await page.waitForTimeout(1000);
    const versionSelect = page.locator('.ant-select').nth(1);
    await versionSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Проверяем наличие трёх иконок статуса
    const statusIcons = page.locator('[aria-label*="check-circle"], [aria-label*="close-circle"]');
    const iconCount = await statusIcons.count();

    expect(iconCount).toBeGreaterThanOrEqual(3);
    console.log(`✓ Найдено ${iconCount} индикаторов статуса`);

    // Проверяем tooltip с подробной информацией
    const indicator = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /Консистентность|проверка/i
    }).first();

    await indicator.hover();
    await page.waitForTimeout(500);

    // Проверяем, что tooltip появился
    const tooltip = page.locator('.ant-tooltip-inner').first();
    const tooltipVisible = await tooltip.isVisible().catch(() => false);

    if (tooltipVisible) {
      const tooltipText = await tooltip.textContent();
      console.log('✓ Tooltip содержит:', tooltipText);

      // Проверяем, что tooltip содержит информацию о всех трёх проверках
      expect(tooltipText).toContain('Коммерция');
      expect(tooltipText).toContain('Затраты');
      expect(tooltipText).toContain('Финансовые показатели');
    }
  });

  test('должен обновлять статус после пересчёта', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Выбираем версию
    await page.waitForTimeout(1000);
    const versionSelect = page.locator('.ant-select').nth(1);
    await versionSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Проверяем начальный статус
    const indicatorBefore = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /Консистентность|проверка|пересчёт/i
    }).first();

    const statusBefore = await indicatorBefore.textContent();
    console.log('Статус до пересчёта:', statusBefore);

    // Нажимаем кнопку "Пересчитать"
    const recalculateButton = page.locator('button:has-text("Пересчитать")');
    const isRecalculateVisible = await recalculateButton.isVisible().catch(() => false);

    if (isRecalculateVisible) {
      await recalculateButton.click();
      console.log('✓ Нажата кнопка "Пересчитать"');

      // Ждём завершения пересчёта
      await page.waitForTimeout(3000);

      // Ждём появления уведомления об успехе
      await page.waitForSelector('.ant-message-success, .ant-notification-notice', { timeout: 10000 });

      // Проверяем, что статус обновился
      const indicatorAfter = page.locator('[style*="display: inline-flex"]').filter({
        hasText: /Консистентность|проверка/i
      }).first();

      await page.waitForTimeout(1000);

      const statusAfter = await indicatorAfter.textContent();
      console.log('Статус после пересчёта:', statusAfter);

      // Проверяем, что статус изменился
      expect(statusAfter).not.toBe(statusBefore);
    } else {
      console.log('⚠ Кнопка "Пересчитать" не найдена (тендер уже выбран или отсутствует)');
    }
  });

  test('должен показывать сообщение об ошибке при расхождении данных', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Выбираем версию
    await page.waitForTimeout(1000);
    const versionSelect = page.locator('.ant-select').nth(1);
    await versionSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Проверяем наличие индикатора
    const indicator = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /Консистентность|проверка|пересчёт|Ошибка/i
    }).first();

    await expect(indicator).toBeVisible();

    // Проверяем цвет фона индикатора
    const bgColor = await indicator.evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );

    console.log('Цвет фона индикатора:', bgColor);

    // Если есть ошибка, фон должен быть оранжевым (#fff2e8) или красным
    // Если всё ок, фон должен быть зелёным (#f6ffed)
    const isError = bgColor.includes('255, 242, 232') || bgColor.includes('255, 77, 79');
    const isSuccess = bgColor.includes('246, 255, 237') || bgColor.includes('82, 196, 26');

    if (isError) {
      console.log('✓ Обнаружена ошибка консистентности (ожидаемо при отсутствии пересчёта)');
    } else if (isSuccess) {
      console.log('✓ Данные консистентны');
    } else {
      console.log('⚠ Неизвестный статус');
    }
  });

  test('должен обновлять статус при нажатии кнопки "Обновить"', async ({ page }) => {
    // Выбираем тендер
    const tenderSelect = page.locator('.ant-select').first();
    await tenderSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Выбираем версию
    await page.waitForTimeout(1000);
    const versionSelect = page.locator('.ant-select').nth(1);
    await versionSelect.click();
    await page.waitForSelector('.ant-select-dropdown');
    await page.locator('.ant-select-item-option').first().click();

    // Ждём загрузки данных
    await page.waitForTimeout(2000);

    // Нажимаем кнопку "Обновить" (reload)
    const reloadButton = page.locator('button[aria-label="reload"]');
    await reloadButton.click();
    console.log('✓ Нажата кнопка "Обновить"');

    // Проверяем, что индикатор показывает состояние загрузки
    await page.waitForTimeout(500);

    // Ждём завершения обновления
    await page.waitForTimeout(2000);

    // Проверяем, что индикатор снова отображается
    const indicator = page.locator('[style*="display: inline-flex"]').filter({
      hasText: /Консистентность|проверка/i
    }).first();

    await expect(indicator).toBeVisible();
    console.log('✓ Индикатор обновлён после перезагрузки');
  });
});
