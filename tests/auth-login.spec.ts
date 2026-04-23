import { test, expect } from '@playwright/test';

test.describe('Аутентификация', () => {
  test('должен успешно войти и перенаправить на dashboard', async ({ page }) => {
    // Логируем консольные сообщения браузера
    page.on('console', msg => console.log('BROWSER:', msg.text()));

    // Логируем ошибки в браузере
    page.on('pageerror', error => console.error('PAGE ERROR:', error.message));

    // Переходим на страницу логина
    await page.goto('http://localhost:5185/login');

    // Проверяем, что мы на странице логина
    await expect(page).toHaveURL('http://localhost:5185/login');

    // Проверяем наличие формы входа
    await expect(page.getByText('TenderHUB')).toBeVisible();
    await expect(page.getByPlaceholder('example@su10.ru')).toBeVisible();
    await expect(page.getByPlaceholder('Введите пароль')).toBeVisible();

    // Вводим учетные данные (используем реальные данные из вашей БД)
    await page.getByPlaceholder('example@su10.ru').fill('odintsov.su10@gmail.com');
    await page.getByPlaceholder('Введите пароль').fill('545454');

    // Засекаем время перед нажатием на кнопку "Войти"
    const startTime = Date.now();

    // Нажимаем кнопку "Войти"
    await page.getByRole('button', { name: 'Войти' }).click();

    // Ждем редиректа на dashboard (максимум 5 секунд)
    await page.waitForURL('http://localhost:5185/dashboard', { timeout: 5000 });

    // Вычисляем время редиректа
    const redirectTime = Date.now() - startTime;
    console.log(`⏱️ Время входа и редиректа: ${redirectTime}ms`);

    // Проверяем, что редирект произошел разумно быстро (меньше 3 секунд)
    // Учитываем 2 сетевых запроса: auth + user data
    expect(redirectTime).toBeLessThan(3000);

    // Проверяем, что мы на dashboard
    await expect(page).toHaveURL('http://localhost:5185/dashboard');

    // Проверяем наличие элементов dashboard
    await expect(page.getByText('Затраты на строительство')).toBeVisible({ timeout: 5000 });
  });

  test('должен показать ошибку при неверных учетных данных', async ({ page }) => {
    // Переходим на страницу логина
    await page.goto('http://localhost:5185/login');

    // Вводим неверные учетные данные
    await page.getByPlaceholder('example@su10.ru').fill('wrong@email.com');
    await page.getByPlaceholder('Введите пароль').fill('wrongpassword');

    // Нажимаем кнопку "Войти"
    await page.getByRole('button', { name: 'Войти' }).click();

    // Проверяем, что показалось сообщение об ошибке
    await expect(page.getByText('Неверный email или пароль')).toBeVisible({ timeout: 3000 });

    // Проверяем, что мы все еще на странице логина
    await expect(page).toHaveURL('http://localhost:5185/login');
  });

  test('должен перенаправить на dashboard если пользователь уже авторизован', async ({ page }) => {
    // Логируем консольные сообщения браузера
    page.on('console', msg => console.log('BROWSER:', msg.text()));

    // Сначала логинимся
    await page.goto('http://localhost:5185/login');
    await page.getByPlaceholder('example@su10.ru').fill('odintsov.su10@gmail.com');
    await page.getByPlaceholder('Введите пароль').fill('545454');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Ждем редиректа на dashboard
    await page.waitForURL('http://localhost:5185/dashboard', { timeout: 5000 });
    await expect(page).toHaveURL('http://localhost:5185/dashboard');

    // Теперь пытаемся открыть страницу логина снова
    console.log('🔄 Попытка открыть /login, когда уже авторизован');
    await page.goto('http://localhost:5185/login');

    // Должен автоматически перенаправить на dashboard
    await page.waitForURL('http://localhost:5185/dashboard', { timeout: 3000 });
    await expect(page).toHaveURL('http://localhost:5185/dashboard');
    console.log('✅ Автоматический редирект сработал');
  });
});
