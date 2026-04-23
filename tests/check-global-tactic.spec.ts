import { test, expect } from '@playwright/test';

test('Отображение глобальной схемы наценок', async ({ page }) => {
  // Переходим на страницу Commerce
  await page.goto('http://localhost:5185/commerce');

  // Ждем загрузки страницы
  await page.waitForSelector('h3:has-text("Коммерция")', { timeout: 10000 });

  // Открываем консоль для просмотра вывода
  page.on('console', msg => {
    if (msg.type() === 'log') {
      console.log(msg.text());
    }
  });

  // Выполняем функцию в контексте страницы
  const result = await page.evaluate(async () => {
    // Проверяем наличие функции
    if (typeof (window as any).showGlobalTactic !== 'function') {
      return { error: 'Функция showGlobalTactic не найдена' };
    }

    // Захватываем console.log
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    // Выполняем функцию
    try {
      await (window as any).showGlobalTactic();
    } catch (error) {
      return { error: error.toString() };
    }

    // Восстанавливаем console.log
    console.log = originalLog;

    return { logs };
  });

  if (result.error) {
    console.error('Ошибка:', result.error);
  } else if (result.logs) {
    console.log('\n=== ВЫВОД ФУНКЦИИ showGlobalTactic ===\n');
    result.logs.forEach(log => console.log(log));
  }

  // Проверяем, что функция выполнилась
  expect(result.error).toBeUndefined();
});