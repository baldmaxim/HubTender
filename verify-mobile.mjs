import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outputDir = path.join(process.cwd(), 'verify-screenshots');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.createContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    console.log('🌐 Navigating to localhost:5185...');
    await page.goto('http://localhost:5185/login', { waitUntil: 'networkidle', timeout: 30000 });

    // Ждём загрузки страницы
    await page.waitForSelector('button, input', { timeout: 10000 });
    console.log('✅ Login page loaded');

    // Пытаемся залогиниться (если нужны реальные креды, скрипт умрёт здесь)
    // Для тестирования просто перейдём на projects, если система позволит
    console.log('📱 Navigating to /projects...');
    await page.goto('http://localhost:5185/projects', { waitUntil: 'networkidle', timeout: 30000 });

    // Скринируем первый таб
    await page.screenshot({ path: path.join(outputDir, '01-projects-list.png'), fullPage: false });
    console.log('📸 Screenshot: projects list');

    // Пытаемся найти и кликнуть на первый проект
    const projectCards = await page.locator('[class*="project"], [class*="card"]').first();
    if (projectCards) {
      await projectCards.click();
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 });
      console.log('✅ Clicked on project');

      // Ждём загрузки карточек
      await page.waitForSelector('[class*="Statistic"]', { timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(1000);

      // Скринируем Настройки объекта (первый таб)
      await page.screenshot({ path: path.join(outputDir, '02-settings-tab.png'), fullPage: false });
      console.log('📸 Screenshot: Settings tab (stat cards)');

      // Ищем табы и кликаем на "Доп. соглашения"
      const tabs = await page.locator('[role="tablist"] button, [class*="tab"]').all();
      if (tabs.length > 1) {
        await tabs[1].click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outputDir, '03-agreements-tab.png'), fullPage: false });
        console.log('📸 Screenshot: Agreements tab (stat cards)');
      }

      // Кликаем на "Выполнение по месяцам"
      if (tabs.length > 2) {
        await tabs[2].click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outputDir, '04-completion-tab.png'), fullPage: false });
        console.log('📸 Screenshot: Completion tab (stat cards)');
      }
    }

    console.log('\n✅ Verification complete! Screenshots saved to', outputDir);
  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    process.exit(1);
  } finally {
    await context.close();
    await browser.close();
  }
})();
