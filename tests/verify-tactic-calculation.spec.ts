import { test, expect } from '@playwright/test';

test('Проверка пошагового расчёта с правильными параметрами', async ({ page }) => {
  // Переходим на страницу Commerce
  await page.goto('http://localhost:5185/commerce');

  // Ждем загрузки страницы
  await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

  // Выбираем первый тендер
  const tenderSelect = page.locator('.ant-select').first();
  await tenderSelect.click();
  await page.waitForTimeout(500);

  const tenderOption = page.locator('.ant-select-dropdown').first().locator('.ant-select-item').first();
  if (await tenderOption.isVisible()) {
    await tenderOption.click();
    await page.waitForTimeout(1500);

    console.log('✅ Тендер выбран');

    // Открываем консоль для проверки логов
    page.on('console', msg => {
      const text = msg.text();
      // Выводим только важные логи
      if (text.includes('material_cost_growth') ||
          text.includes('Загружены параметры') ||
          text.includes('calculateMarkupResult')) {
        console.log('📋 Консоль:', text);
      }
    });

    // Нажимаем "Пересчитать"
    const recalcButton = page.locator('button:has-text("Пересчитать")');
    console.log('🔄 Нажимаем "Пересчитать"...');
    await recalcButton.click();

    // Ждем завершения расчета
    await page.waitForTimeout(5000);

    console.log('✅ Пересчёт завершён');

    // Проверяем коэффициенты через evaluate
    const result = await page.evaluate(async () => {
      if (typeof (window as any).verifyCoefficients === 'function') {
        const logs: string[] = [];
        const originalLog = console.log;
        console.log = (...args: any[]) => {
          logs.push(args.join(' '));
          originalLog(...args);
        };

        const tenderId = localStorage.getItem('selectedTenderId') || 'cf2d6854-2851-4692-9956-e873b147d789';
        await (window as any).verifyCoefficients(tenderId);

        console.log = originalLog;

        // Извлекаем коэффициенты из логов
        const coefficients: { [key: string]: number } = {};
        let currentType = '';

        logs.forEach(log => {
          if (log.includes('--- МАТ ---')) currentType = 'мат';
          else if (log.includes('--- РАБ ---')) currentType = 'раб';
          else if (log.includes('--- СУБ-МАТ ---')) currentType = 'суб-мат';
          else if (log.includes('--- СУБ-РАБ ---')) currentType = 'суб-раб';

          if (log.includes('Рассчитанный коэффициент:')) {
            const match = log.match(/Рассчитанный коэффициент: ([\d.]+)/);
            if (match && currentType) {
              coefficients[currentType] = parseFloat(match[1]);
            }
          }
        });

        return { logs, coefficients };
      }
      return { error: 'Функция verifyCoefficients не найдена' };
    });

    if (result.coefficients) {
      console.log('\n📊 Полученные коэффициенты:');
      console.log('МАТ:', result.coefficients['мат']?.toFixed(6) || 'не рассчитан');
      console.log('РАБ:', result.coefficients['раб']?.toFixed(6) || 'не рассчитан');
      console.log('СУБ-МАТ:', result.coefficients['суб-мат']?.toFixed(6) || 'не рассчитан');
      console.log('СУБ-РАБ:', result.coefficients['суб-раб']?.toFixed(6) || 'не рассчитан');

      // Проверяем МАТ
      if (result.coefficients['мат']) {
        const matCoeff = result.coefficients['мат'];
        if (Math.abs(matCoeff - 1.64076) < 0.001) {
          console.log('\n✅ МАТ ПРАВИЛЬНЫЙ! Пошаговый расчёт работает корректно!');
          console.log('Это означает, что material_cost_growth = 10% используется в расчётах');
        } else {
          console.log(`\n⚠️ МАТ: ${matCoeff.toFixed(6)}, ожидалось: 1.640760`);
          if (Math.abs(matCoeff - 1.49556) < 0.001) {
            console.log('Похоже, material_cost_growth всё ещё не применяется (расчёт как при 0%)');
          }
        }
      }
    }
  }
});