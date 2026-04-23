import { test, expect } from '@playwright/test';

test.describe('Tenders Page Debug', () => {
  test('should check for console errors and infinite loops', async ({ page }) => {
    const consoleMessages: string[] = [];
    const errors: string[] = [];

    // Собираем console.log сообщения
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });

    // Собираем ошибки
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Переходим на страницу тендеров
    await page.goto('http://localhost:5185/admin/tenders');

    // Ждём 5 секунд
    await page.waitForTimeout(5000);

    console.log('Console messages:', consoleMessages);
    console.log('Errors:', errors);

    // Проверяем наличие ошибок
    expect(errors).toHaveLength(0);

    // Пытаемся кликнуть на Dashboard
    const dashboardLink = page.locator('a[href="/dashboard"]').first();
    await dashboardLink.click();

    // Ждём 3 секунды после клика
    await page.waitForTimeout(3000);

    // Проверяем URL
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // Проверяем, что мы перешли на dashboard
    expect(currentUrl).toContain('dashboard');
  });

  test('should check network requests', async ({ page }) => {
    const requests: string[] = [];

    page.on('request', request => {
      requests.push(request.url());
    });

    await page.goto('http://localhost:5185/admin/tenders');
    await page.waitForTimeout(5000);

    console.log('Network requests:', requests.filter(r => r.includes('supabase')));

    // Пытаемся перейти
    await page.click('a[href="/dashboard"]');
    await page.waitForTimeout(2000);

    console.log('URL after click:', page.url());
  });
});
