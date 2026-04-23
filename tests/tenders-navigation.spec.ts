import { test, expect } from '@playwright/test';

test.describe('Tenders Page Navigation', () => {
  test('should allow navigation away from tenders page', async ({ page }) => {
    // Переходим на страницу тендеров
    await page.goto('http://localhost:5185/admin/tenders');

    // Ждём загрузки страницы (максимум 10 секунд)
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Пытаемся перейти на страницу Дашборда через меню
    const dashboardLink = page.locator('a[href="/dashboard"]').first();
    await expect(dashboardLink).toBeVisible();
    await dashboardLink.click();

    // Проверяем, что мы успешно перешли на дашборд
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('text=Дашборд')).toBeVisible({ timeout: 5000 });
  });

  test('should load tenders page without infinite loading', async ({ page }) => {
    await page.goto('http://localhost:5185/admin/tenders');

    // Проверяем, что страница загрузилась
    await expect(page.locator('text=Тендеры')).toBeVisible({ timeout: 10000 });

    // Проверяем, что спиннер исчез
    const spinner = page.locator('.ant-spin-spinning');
    await expect(spinner).toHaveCount(0, { timeout: 15000 });
  });
});
