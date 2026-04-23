import { test, expect } from '@playwright/test';

test.describe('Multi-tab positions test', () => {
  test('should load 5 position pages simultaneously without infinite loading', async ({ browser }) => {
    test.setTimeout(180000);
    const context = await browser.newContext();
    const mainPage = await context.newPage();

    const email = 'Odintsov.su10@gmail.com';
    const password = '545454';

    console.log('\n' + '='.repeat(80));
    console.log('🧪 ТЕСТ: 5 вкладок позиций одновременно');
    console.log('='.repeat(80));

    // Step 1: Login
    console.log('\n1️⃣  ЛОГИН');
    await mainPage.goto('/login');
    await mainPage.waitForLoadState('networkidle');

    const emailInput = mainPage.locator('input[placeholder="example@su10.ru"]');
    const passwordInput = mainPage.locator('input[placeholder="Введите пароль"]');

    await emailInput.fill(email);
    await passwordInput.fill(password);

    const loginButton = mainPage.locator('button').filter({ hasText: 'Войти' }).first();
    await loginButton.click();

    await mainPage.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
    await mainPage.waitForLoadState('networkidle');
    console.log('✅ Логин успешен');

    // Step 2: Go to positions
    console.log('\n2️⃣  ПЕРЕХОД НА /positions');
    await mainPage.goto('/positions');
    await mainPage.waitForLoadState('networkidle');
    await mainPage.waitForTimeout(1000);
    console.log('✅ На странице /positions');

    // Step 3: Click tender card directly (simpler approach)
    console.log('\n3️⃣  ВЫБОР ТЕНДЕРА "События 6.2" ЧЕРЕЗ КАРТОЧКУ');

    // Find and click the tender card for "События 6.2"
    const cards = mainPage.locator('div[class*="hoverable"][style*="cursor: pointer"]');
    const cardCount = await cards.count();
    console.log(`   Найдено ${cardCount} карточек тендеров`);

    let cardClicked = false;
    for (let i = 0; i < cardCount; i++) {
      const cardText = await cards.nth(i).textContent();
      if (cardText && cardText.includes('События 6.2')) {
        console.log(`   ✓ Кликаю на карточку События 6.2 (индекс ${i})`);
        await cards.nth(i).click();
        cardClicked = true;
        break;
      }
    }

    if (!cardClicked) {
      console.log('   ⚠️  Карточка События 6.2 не найдена, ищу альтернативный способ');
      // Fallback: use select dropdowns
      const selects = mainPage.locator('[class*="ant-select"]');
      const selectCount = await selects.count();

      if (selectCount > 0) {
        await selects.nth(0).click();
        await mainPage.waitForTimeout(500);

        const options = mainPage.locator('[class*="rc-virtual-list"] [class*="option"], [class*="ant-select-item"]');
        for (let i = 0; i < await options.count(); i++) {
          const text = await options.nth(i).textContent();
          if (text && text.includes('События 6.2')) {
            await options.nth(i).click();
            break;
          }
        }
      }
    }

    await mainPage.waitForLoadState('networkidle');
    await mainPage.waitForTimeout(3000);
    console.log('✅ Тендер выбран');

    // Step 4: Find position row and get its ID
    console.log('\n4️⃣  ПОИСК СТРОКИ ПОЗИЦИИ');
    await mainPage.waitForTimeout(2000);

    // Find all rows in the table (tbody rows or Ant Design virtual rows)
    const tableRows = mainPage.locator('table tbody tr');
    const rowCount = await tableRows.count();
    console.log(`🔍 Найдено ${rowCount} строк в tbody`);

    let selectedRowId: string | null = null;

    // If we found rows, get the ID from the first clickable row
    if (rowCount > 0) {
      const firstRow = tableRows.nth(0);
      const rowKey = await firstRow.getAttribute('data-row-key');
      console.log(`   Row 0 data-row-key: ${rowKey}`);

      if (rowKey) {
        selectedRowId = rowKey;
      }
    }

    // If no rows found or no data-row-key, try to extract ID from any visible position text
    if (!selectedRowId) {
      console.log('   Пробую найти позицию по видимому тексту');
      // Look for any text that looks like a position number (e.g., "01.01.01")
      const positionText = mainPage.locator('[class*="ant-table-cell"]:has-text("01.01.01")');
      if (await positionText.count() > 0) {
        const parent = positionText.first().locator('xpath=ancestor::tr');
        selectedRowId = await parent.getAttribute('data-row-key');
        console.log(`   Найдена позиция с ID: ${selectedRowId}`);
      }
    }

    // Fallback: use a hardcoded URL for testing
    if (!selectedRowId) {
      console.log('   Используется fallback позиция');
      // We'll construct a URL by clicking on the first table row and capturing the new tab URL
    }

    const row3Href = selectedRowId ? `/positions/${selectedRowId}/items` : null;

    if (!row3Href) {
      // Try clicking first position row to capture the new tab URL
      console.log('   Кликаю на первую позицию чтобы захватить URL');
      const positionNameLink = mainPage.locator('table tbody tr:first-child td:nth-child(2)');
      console.log(`   Текст позиции: ${await positionNameLink.textContent()}`);
      throw new Error('❌ Не удалось определить ID позиции');
    }

    // Step 5: Open 5 tabs with same position simultaneously
    console.log('\n5️⃣  ОТКРЫТИЕ 5 ВКЛАДОК СТРОКИ №3 ОДНОВРЕМЕННО');
    const pages = [mainPage];
    const pageStatuses: { tab: number; url: string; loaded: boolean; hasData: boolean }[] = [];

    const tabPromises = Array(5).fill(null).map((_, index) => {
      return (async () => {
        try {
          const newPage = await context.newPage();
          console.log(`   ⏳ Вкладка ${index + 1}: открываю ${row3Href}`);

          // Navigate with longer timeout
          await Promise.race([
            newPage.goto(row3Href, { waitUntil: 'domcontentloaded' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 45000))
          ]);

          // Wait for page to stabilize
          await newPage.waitForTimeout(3000);
          const url = newPage.url();

          // Check if page loaded properly
          const isOnCorrectPage = url.includes('/items') || url.includes('/positions/');
          const isOnLogin = url.includes('/login');
          const hasContent = await newPage.locator('body').textContent();
          const hasLoadingSpinner = await newPage.locator('[class*="spin"]').count();

          const loaded = !isOnLogin && isOnCorrectPage && !hasLoadingSpinner;
          const hasData = hasContent && hasContent.length > 100;

          pageStatuses.push({
            tab: index + 1,
            url,
            loaded,
            hasData
          });

          console.log(`   ${loaded ? '✅' : '❌'} Вкладка ${index + 1}: ${url}`);
          if (!loaded) {
            console.log(`      Loading spinner: ${hasLoadingSpinner}`);
          }

          pages.push(newPage);
          return newPage;
        } catch (error) {
          console.error(`   ❌ Вкладка ${index + 1} ошибка:`, error);
          pageStatuses.push({
            tab: index + 1,
            url: 'ERROR',
            loaded: false,
            hasData: false
          });
          throw error;
        }
      })();
    });

    await Promise.all(tabPromises);
    console.log(`✅ Все 5 вкладок обработаны`);

    // Step 6: Verify results
    console.log('\n6️⃣  РЕЗУЛЬТАТЫ');
    console.log('-'.repeat(80));

    let allLoaded = true;
    let allHaveData = true;

    for (const status of pageStatuses) {
      const statusStr = status.loaded ? '✅ LOADED' : '❌ FAILED';
      const dataStr = status.hasData ? '📊 HAS DATA' : '⚠️  NO DATA';
      console.log(`${statusStr} | ${dataStr} | Вкладка ${status.tab}: ${status.url}`);

      if (!status.loaded) allLoaded = false;
      if (!status.hasData) allHaveData = false;
    }

    // Final result
    console.log('\n' + '='.repeat(80));
    if (allLoaded && allHaveData) {
      console.log('✅ ТЕСТ ПРОЙДЕН: Все 5 вкладок загружены с данными!');
    } else if (allLoaded) {
      console.log('⚠️  ЧАСТИЧНЫЙ УСПЕХ: Все вкладки загружены, но некоторые без данных');
    } else {
      console.log('❌ ТЕСТ НЕ ПРОЙДЕН: Некоторые вкладки не загружены');
    }
    console.log('='.repeat(80) + '\n');

    await context.close();

    expect(allLoaded, 'All tabs should be loaded').toBe(true);
  });
});
