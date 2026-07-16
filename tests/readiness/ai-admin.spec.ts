import { expect, Page, test } from '@playwright/test';

// Этап 2.5 (§28): browser smoke страницы «AI и нейросети» против production
// bundle + fake OpenRouter (реальный API не используется). Сценарий:
// подключение → каталог → фильтр → выбор → draft → (активация недоступна) →
// тест модели → активация → rollout off. Console errors = 0.

const EMAIL = process.env.E2E_EMAIL ?? 'e2e@test.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Test1234!';
const OR_STATS = process.env.E2E_OPENROUTER_STATS ?? '';

const consoleErrors: string[] = [];
const pageErrors: string[] = [];

function watch(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('example@su10.ru').fill(EMAIL);
  await page.getByPlaceholder('Введите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/dashboard|\/$/, { timeout: 30_000 });
}

test.describe.serial('AI администрирование (этап 2.5)', () => {
  test('полный admin-flow: подключение → каталог → тест → активация → rollout off', async ({ page, request }) => {
    watch(page);
    await login(page);

    // 2. Открыть AI settings.
    await page.goto('/admin/ai-settings');
    await expect(page.getByText('AI и нейросети — сопоставление номенклатуры')).toBeVisible({ timeout: 20_000 });

    // 3. Key configured + пояснение про server secret; поля ввода ключа НЕТ.
    await expect(page.getByText('API key настроен')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('OPENROUTER_API_KEY', { exact: false })).toBeVisible();
    expect(await page.locator('input[type="password"]').count()).toBe(0);

    // 4. Проверить подключение (живой запрос к fake OpenRouter).
    await page.getByTestId('ai-test-connection').click();
    await expect(page.getByTestId('ai-connection-status')).toContainText('подтверждено', { timeout: 15_000 });
    await expect(page.getByText('e2e-fake-key')).toBeVisible();

    // 5. Каталог загружен; router (openrouter/auto) и истёкшая модель
    //    отфильтрованы сервером.
    await expect(page.getByTestId('ai-catalog-state')).toContainText('Каталог обновлён', { timeout: 20_000 });
    await expect(page.getByText('fakeai/rerank-pro').first()).toBeVisible();
    await expect(page.getByText('openrouter/auto')).toHaveCount(0);
    await expect(page.getByText('fakeai/legacy')).toHaveCount(0);

    // 6. Фильтр по поиску (data-testid antd вешает на сам <input>).
    await page.getByTestId('ai-model-search').fill('rerank-mini');
    await page.keyboard.press('Enter');
    await expect(page.getByText('fakeai/rerank-pro')).toHaveCount(0);
    await page.getByTestId('ai-model-search').clear();
    await page.keyboard.press('Enter');

    // 7. Выбрать exact model (radio в строке каталога).
    const row = page.locator('tr', { hasText: 'fakeai/rerank-pro' }).first();
    await row.locator('input[type="radio"]').check();

    // 8. Сохранить draft.
    await page.getByTestId('ai-save-draft').click();
    await expect(page.getByText('Черновик сохранён', { exact: false })).toBeVisible({ timeout: 15_000 });

    // 9. Активация недоступна до теста.
    await expect(page.getByTestId('ai-activate')).toBeDisabled();
    await expect(page.getByTestId('ai-activation-blockers')).toContainText('Требуется проверка модели');

    // 10-11. Тест модели → результаты сценариев.
    await page.getByTestId('ai-test-model').click();
    await expect(page.getByTestId('ai-test-status')).toContainText('пройдена', { timeout: 30_000 });
    const scenarios = page.getByTestId('ai-test-scenarios');
    await expect(scenarios).toBeVisible();
    await expect(scenarios.getByText('Явное совпадение', { exact: false })).toBeVisible();
    await expect(scenarios.getByText('Hard negative', { exact: false })).toBeVisible();
    await expect(scenarios.getByText('Abstain', { exact: false })).toBeVisible();
    await expect(scenarios.getByText('Prompt injection', { exact: false })).toBeVisible();
    expect(await scenarios.getByText('провален').count()).toBe(0);

    // 12. Активировать конфигурацию.
    await expect(page.getByTestId('ai-activate')).toBeEnabled();
    await page.getByTestId('ai-activate').click();
    await expect(page.getByText('конфигурация активна')).toBeVisible({ timeout: 15_000 });

    // 13. Rollout остаётся off: пользовательские AI-запросы не включены.
    await expect(page.getByTestId('ai-rollout-status')).toContainText('контролируемого запуска');

    // Fake OpenRouter получил ровно ОДИН chat-вызов — админский model test.
    if (OR_STATS) {
      const stats = await (await request.get(OR_STATS)).json();
      expect(stats.chat).toBe(1);
    }
  });

  test('нет ошибок консоли/страницы на admin AI-странице', async () => {
    const benign = consoleErrors.filter(
      (e) => !/favicon|manifest|ResizeObserver loop/i.test(e)
    );
    expect(benign, `console errors:\n${benign.join('\n')}`).toHaveLength(0);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
  });
});
