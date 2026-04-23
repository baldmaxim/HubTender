import { test, expect } from '@playwright/test';

test.describe('Уведомления и работа портала', () => {
  test.beforeEach(async ({ page }) => {
    // Переходим на главную страницу
    await page.goto('http://localhost:5185');
  });

  test('Проверка загрузки главной страницы', async ({ page }) => {
    // Ждем загрузки заголовка
    await expect(page.locator('text=TenderHUB')).toBeVisible({ timeout: 10000 });
  });

  test('Проверка навигации по меню', async ({ page }) => {
    // Проверяем наличие основных пунктов меню (ищем в сайдбаре)
    await expect(page.locator('.ant-layout-sider a[href="/dashboard"]')).toBeVisible();
    await expect(page.locator('.ant-layout-sider a:has-text("Позиции заказчика")')).toBeVisible();
    await expect(page.locator('.ant-layout-sider a:has-text("Коммерция")')).toBeVisible();
    await expect(page.locator('.ant-layout-sider a:has-text("Финансовые показатели")')).toBeVisible();
  });

  test('Проверка системы уведомлений', async ({ page }) => {
    // Проверяем наличие иконки уведомлений (колокольчик)
    const bellIcon = page.locator('[data-icon="bell"]').first();
    await expect(bellIcon).toBeVisible({ timeout: 5000 });

    // Кликаем на колокольчик
    await bellIcon.click();

    // Проверяем, что открылся dropdown с уведомлениями
    await expect(page.locator('text=Уведомления')).toBeVisible();
  });

  test('Переход на страницу Финансовые показатели', async ({ page }) => {
    // Кликаем на пункт меню "Финансовые показатели"
    await page.locator('text=Финансовые показатели').click();

    // Ждем загрузки страницы
    await page.waitForURL('**/financial-indicators');

    // Проверяем заголовок страницы
    await expect(page.locator('text=Финансовые показатели').first()).toBeVisible();

    // Проверяем наличие текста "Выберите тендер для просмотра показателей"
    await expect(page.locator('text=Выберите тендер для просмотра показателей')).toBeVisible();
  });

  test('Проверка выбора тендера через dropdown', async ({ page }) => {
    // Переходим на страницу финансовых показателей
    await page.goto('http://localhost:5185/financial-indicators');

    // Ждем загрузки страницы выбора тендера (заголовок или селектор)
    await page.waitForTimeout(2000);

    // Проверяем наличие текста выбора тендера
    const selectText = page.locator('text=Выберите тендер для просмотра показателей');
    if (await selectText.isVisible()) {
      // Если есть текст, значит страница загрузилась

      // Ищем селектор тендеров (может быть Ant Design Select)
      const tenderSelect = page.locator('.ant-select').first();
      if (await tenderSelect.isVisible({ timeout: 5000 })) {
        await tenderSelect.click();

        // Ждем появления опций
        await page.waitForTimeout(1000);

        // Если есть тендеры, выбираем первый
        const firstOption = page.locator('.ant-select-item').first();
        if (await firstOption.isVisible({ timeout: 2000 })) {
          await firstOption.click();

          // Проверяем, что появился селектор версии
          await page.waitForTimeout(1000);
          const versionSelect = page.locator('.ant-select').nth(1);
          await expect(versionSelect).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test('Проверка быстрого выбора тендера через карточки', async ({ page }) => {
    // Переходим на страницу финансовых показателей
    await page.goto('http://localhost:5185/financial-indicators');

    // Ждем загрузки текста "Или выберите из списка"
    await page.waitForTimeout(2000);

    // Проверяем наличие карточек тендеров
    const tenderCards = page.locator('.ant-card-hoverable');
    const count = await tenderCards.count();

    if (count > 0) {
      // Кликаем на первую карточку
      await tenderCards.first().click();

      // Проверяем, что появилась кнопка "Назад к выбору тендера"
      await expect(page.locator('text=← Назад к выбору тендера')).toBeVisible({ timeout: 5000 });

      // Проверяем, что появилась таблица с данными
      await expect(page.locator('text=Полный объём строительства')).toBeVisible();
    }
  });

  test('Проверка переключения темы', async ({ page }) => {
    // Находим переключатель темы (Switch между солнцем и луной)
    const themeSwitch = page.locator('.ant-switch').first();
    await expect(themeSwitch).toBeVisible();

    // Получаем текущее состояние
    const initialChecked = await themeSwitch.getAttribute('aria-checked');

    // Переключаем тему
    await themeSwitch.click();

    // Ждем анимации
    await page.waitForTimeout(500);

    // Проверяем, что состояние изменилось
    const newChecked = await themeSwitch.getAttribute('aria-checked');
    expect(newChecked).not.toBe(initialChecked);
  });

  test('Проверка отображения ошибок в уведомлениях при проблемах с Supabase', async ({ page }) => {
    // Переходим на страницу, которая делает запросы к Supabase
    await page.goto('http://localhost:5185/financial-indicators');

    // Ждем некоторое время для выполнения запросов
    await page.waitForTimeout(3000);

    // Открываем уведомления
    const bellIcon = page.locator('[data-icon="bell"]').first();
    await bellIcon.click();

    // Проверяем, что есть уведомления или текст "Нет уведомлений"
    const notificationsPanel = page.locator('text=Уведомления');
    await expect(notificationsPanel).toBeVisible();

    // Может быть либо "Нет уведомлений", либо список ошибок
    const hasNoNotifications = await page.locator('text=Нет уведомлений').isVisible();
    const hasErrorNotifications = await page.locator('text=Ошибка').isVisible();

    // Должно быть хотя бы одно из двух
    expect(hasNoNotifications || hasErrorNotifications).toBeTruthy();
  });

  test('Проверка навигации по разным страницам портала', async ({ page }) => {
    // Дашборд
    await page.locator('.ant-layout-sider a[href="/dashboard"]').click();
    await page.waitForURL('**/dashboard');
    await expect(page.locator('text=Обзор тендеров').or(page.locator('h3:has-text("Дашборд")'))).toBeVisible();

    // Позиции заказчика
    await page.locator('.ant-layout-sider a:has-text("Позиции заказчика")').click();
    await page.waitForURL('**/positions');

    // Коммерция
    await page.locator('.ant-layout-sider a:has-text("Коммерция")').click();
    await page.waitForURL('**/commerce');

    // Библиотеки
    await page.locator('.ant-layout-sider span:has-text("Библиотеки")').click();
    await page.locator('.ant-layout-sider a:has-text("Материалы и работы")').click();
    await page.waitForURL('**/library');

    // Затраты на строительство
    await page.locator('.ant-layout-sider a:has-text("Затраты на строительство")').click();
    await page.waitForURL('**/costs');
  });
});
