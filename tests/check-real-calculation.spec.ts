import { test, expect } from '@playwright/test';

test('Проверка реального расчёта на странице Коммерция', async ({ page }) => {
  // Переходим на страницу Commerce
  await page.goto('http://localhost:5185/commerce');

  // Ждем загрузки страницы
  await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

  // Включаем перехват консоли
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'log') {
      const text = msg.text();
      consoleLogs.push(text);
      console.log(text);
    }
  });

  // Выбираем первый тендер
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
    await page.waitForTimeout(3000);

    // Ищем в логах информацию о параметрах
    console.log('\n=== АНАЛИЗ ЛОГОВ РАСЧЁТА ===\n');

    // Ищем параметры наценок
    const paramsLog = consoleLogs.find(log => log.includes('Загружены параметры наценок'));
    if (paramsLog) {
      console.log('Найдены параметры:', paramsLog);
    }

    // Ищем расчёты для МАТ
    const matLogs = consoleLogs.filter(log =>
      log.includes('МАТ') ||
      log.includes('мат:') ||
      log.includes('Материалы РОСТ') ||
      log.includes('107053.5')  // сумма из первого скриншота
    );

    if (matLogs.length > 0) {
      console.log('\nЛоги для материалов:');
      matLogs.forEach(log => console.log(log));
    }

    // Проверяем данные в таблице
    const rows = page.locator('.ant-table-tbody tr');
    const rowCount = await rows.count();

    console.log(`\nНайдено строк в таблице: ${rowCount}`);

    // Ищем строку с материалами
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const nameCell = row.locator('td').nth(1);
      const name = await nameCell.textContent();

      if (name?.includes('Благоустройство')) {
        console.log(`\nНайдена строка: ${name}`);

        // Получаем данные из строки
        const baseAmount = await row.locator('td').nth(3).textContent();
        const commercialAmount = await row.locator('td').nth(4).textContent();
        const markup = await row.locator('td').nth(5).textContent();

        console.log(`Базовая стоимость: ${baseAmount}`);
        console.log(`Коммерческая стоимость: ${commercialAmount}`);
        console.log(`Наценка: ${markup}`);

        // Извлекаем числа
        const base = parseFloat(baseAmount?.replace(/[^\d.-]/g, '') || '0');
        const commercial = parseFloat(commercialAmount?.replace(/[^\d.-]/g, '') || '0');

        if (base > 0) {
          const calculatedMarkup = ((commercial - base) / base * 100).toFixed(2);
          console.log(`Расчётная наценка: ${calculatedMarkup}%`);

          const coefficient = commercial / base;
          console.log(`Коэффициент: ${coefficient.toFixed(6)}`);

          // Проверяем, соответствует ли ожидаемому
          if (coefficient < 1.6) {
            console.log('❌ Коэффициент меньше ожидаемого 1.64076');
            console.log('Возможные причины:');
            console.log('1. Параметры для этого тендера отличаются от стандартных');
            console.log('2. Используется неправильный параметр (subcontract_materials_cost_growth вместо material_cost_growth)');
            console.log('3. Некоторые параметры равны 0');
          } else {
            console.log('✅ Коэффициент соответствует ожидаемому');
          }
        }
      }
    }
  }
});