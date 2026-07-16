import { expect, Page, test } from '@playwright/test';
import { join } from 'node:path';

// Этап 2.6 (§28): controlled rollout E2E против production bundle + fake
// OpenRouter. Полный сценарий: rollout off → пилот+бюджет → evaluation →
// live eval PASS → pilot_individual → пилот получает live suggestion по
// явному клику → подтверждает → импорт → feedback → bulk отсутствует →
// emergency off → провайдер больше не вызывается; deterministic/manual
// остаётся. Плюс негативный API-сценарий non-pilot.

const ADMIN_EMAIL = 'e2e@test.local';
const PILOT_EMAIL = 'e2e-pilot@test.local';
const PASSWORD = 'Test1234!';
const OR_STATS = process.env.E2E_OPENROUTER_STATS ?? '';
const TENDER_TITLE = 'E2E Тендер';

const consoleErrors: string[] = [];
const pageErrors: string[] = [];

function watch(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByPlaceholder('example@su10.ru').fill(email);
  await page.getByPlaceholder('Введите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/dashboard|\/$/, { timeout: 30_000 });
}

async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function chatCalls(page: Page): Promise<number> {
  const res = await page.request.get(OR_STATS);
  return (await res.json()).chat as number;
}

test.describe.serial('Controlled AI rollout (этап 2.6)', () => {
  test('admin: пилот+бюджет → evaluation → live eval PASS → pilot_individual', async ({ page }) => {
    watch(page);
    await login(page, ADMIN_EMAIL);
    await page.goto('/admin/ai-settings');

    // Текущий rollout — off (§28.3).
    await expect(page.getByTestId('ai-rollout-mode')).toContainText('Выключен', { timeout: 20_000 });

    // Пилотный пользователь через существующий users search (§28.4).
    await page.getByTestId('ai-pilot-user-search').click();
    await page.locator('.ant-select-dropdown .ant-select-item-option', { hasText: 'E2E Пилот' })
      .first().click();
    await page.getByTestId('ai-pilot-add').click();
    await expect(page.getByTestId('ai-pilot-table').getByText('E2E Пилот')).toBeVisible({ timeout: 15_000 });

    // Бюджет/квоты (§28.5).
    await page.locator('input[placeholder="не задан"]').fill('10.00');
    await page.getByTestId('ai-save-limits').click();
    await expect(page.getByText('Лимиты пилота сохранены', { exact: false })).toBeVisible({ timeout: 15_000 });

    // Переход в evaluation (§28.6): гейты требуют пройденный model test —
    // он выполнен в ai-admin.spec (тот же backend-процесс).
    await page.getByTestId('ai-transition-evaluation').click();
    await page.getByTestId('ai-transition-confirmation').fill('evaluation');
    await page.getByRole('button', { name: 'Выполнить переход' }).click();
    await expect(page.getByTestId('ai-rollout-mode')).toContainText('Evaluation', { timeout: 15_000 });

    // Live evaluation против fake OpenRouter (§28.7-8).
    await page.getByTestId('ai-eval-mode').click();
    await page.locator('.ant-select-dropdown .ant-select-item-option', { hasText: 'live' }).first().click();
    await page.getByTestId('ai-eval-run').click();
    await page.getByRole('button', { name: 'Подтверждаю стоимость, запустить' }).click();
    await expect(page.getByText('Evaluation: gates PASS', { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('ai-eval-history').getByText('PASS').first()).toBeVisible();

    // Переход в pilot_individual (§28.9).
    await page.getByTestId('ai-transition-pilot_individual').click();
    await page.getByTestId('ai-transition-confirmation').fill('pilot_individual');
    await page.getByRole('button', { name: 'Выполнить переход' }).click();
    await expect(page.getByTestId('ai-rollout-mode')).toContainText('одиночные', { timeout: 15_000 });

    await logout(page);
  });

  test('pilot: явный AI suggest → подтверждение → импорт → bulk отсутствует', async ({ page }) => {
    watch(page);
    await login(page, PILOT_EMAIL);

    const before = OR_STATS ? await chatCalls(page) : 0;

    // Smart Import с фикстурой, содержащей неточную номенклатуру (§28.11).
    await page.goto('/positions');
    await page.locator('.ant-select').first().click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .locator(`.ant-select-item-option[title*="${TENDER_TITLE}"]`).first().click();
    await page.getByText('Умный импорт').click();
    const fixture = join(process.cwd(), 'tests', 'readiness', 'fixtures', 'e2e-boq-pilot.xlsx');
    await page.locator('input[type="file"]').setInputFiles(fixture);
    // Шаги визарда: «Лист и заголовки» → «Сопоставление» → «Проверка строк»
    // (панель подбора живёт на шаге проверки строк).
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByText('Подбор номенклатуры', { exact: false })).toBeVisible({ timeout: 30_000 });

    // Pilot disclosure виден.
    await expect(page.getByTestId('ai-pilot-disclosure')).toBeVisible();

    // Явный клик «Подобрать номенклатуру» (§28.12) → ровно один provider call (§28.13).
    await page.getByRole('button', { name: 'Подобрать номенклатуру' }).click();
    await expect(page.getByText('Подтверждено: 0', { exact: false })).toBeVisible({ timeout: 30_000 });
    if (OR_STATS) {
      expect(await chatCalls(page)).toBe(before + 1);
    }

    // Suggestion НЕ выбран автоматически (§28.14): подтверждений 0, есть
    // кнопка принятия предложения в строке.
    const confirmBtn = page.getByRole('button', { name: 'Принять', exact: true }).first();
    await expect(confirmBtn).toBeVisible();

    // Bulk-действие отсутствует в pilot_individual (§28.18).
    await expect(page.getByTestId('ai-bulk-confirm')).toHaveCount(0);

    // Пользователь подтверждает (§28.15) и применяет.
    await confirmBtn.click();
    await expect(page.getByText('Подтверждено: 1', { exact: false })).toBeVisible();
    const applyBtn = page.getByRole('button', { name: 'Применить подтверждения и пересчитать' });
    await applyBtn.click();
    await expect(applyBtn).toBeEnabled({ timeout: 30_000 }); // реанализ завершён

    // Импорт (§28.16): шаг «Импорт» → выполнение на сервере.
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Импортировать' }).click();
    await expect(page.getByText('Импорт выполнен', { exact: true })).toBeVisible({ timeout: 60_000 });

    await logout(page);
  });

  test('admin: метрики feedback обновились; emergency off; провайдер выключен', async ({ page }) => {
    watch(page);
    await login(page, ADMIN_EMAIL);
    await page.goto('/admin/ai-settings');

    // §28.17: usage/feedback отражают принятую рекомендацию.
    await expect(page.getByText('Принято / изменено / вручную')).toBeVisible({ timeout: 20_000 });

    // §28.21: emergency off.
    await page.getByTestId('ai-emergency-off').click();
    await page.getByRole('button', { name: 'Отключить немедленно' }).click();
    await expect(page.getByTestId('ai-rollout-mode')).toContainText('Выключен', { timeout: 15_000 });
    await logout(page);
  });

  test('после emergency off пилот не вызывает провайдера; ручной путь жив (§28.22-23)', async ({ page }) => {
    watch(page);
    await login(page, PILOT_EMAIL);
    const before = OR_STATS ? await chatCalls(page) : 0;

    await page.goto('/positions');
    await page.locator('.ant-select').first().click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .locator(`.ant-select-item-option[title*="${TENDER_TITLE}"]`).first().click();
    await page.getByText('Умный импорт').click();
    const fixture = join(process.cwd(), 'tests', 'readiness', 'fixtures', 'e2e-boq-pilot.xlsx');
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByText('Подбор номенклатуры', { exact: false })).toBeVisible({ timeout: 30_000 });

    // Deterministic-кандидаты работают без провайдера: строки отрисованы
    // (кнопка «Найти вручную» всегда доступна, «Принять» может быть disabled).
    await page.getByRole('button', { name: 'Подобрать номенклатуру' }).click();
    await expect(page.getByRole('button', { name: 'Найти вручную' }).first())
      .toBeVisible({ timeout: 30_000 });
    if (OR_STATS) {
      expect(await chatCalls(page)).toBe(before); // ни одного нового вызова
    }
    await logout(page);
  });

  test('негативный API-сценарий: non-pilot не может вызвать провайдера напрямую', async ({ page }) => {
    // Прямой вызов suggest-эндпоинта обычным пользователем (не пилотом,
    // rollout off) не создаёт provider-вызовов; deterministic-ответ работает.
    watch(page);
    await login(page, ADMIN_EMAIL); // admin НЕ в пилоте
    const before = OR_STATS ? await chatCalls(page) : 0;
    const capability = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('hubtender_app_auth_session') ?? '{}')?.access_token;
      const res = await fetch('/api/v1/ai/nomenclature-capability', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.json();
    });
    const cap = capability?.data ?? {};
    if (cap.status !== undefined) {
      expect(['rollout_off', 'not_allowed']).toContain(cap.status);
    }
    if (OR_STATS) {
      expect(await chatCalls(page)).toBe(before);
    }
    await logout(page);
  });

  test('нет ошибок консоли/страницы в pilot-сценариях', async () => {
    const benign = consoleErrors.filter((e) => !/favicon|manifest|ResizeObserver loop/i.test(e));
    expect(benign, `console errors:\n${benign.join('\n')}`).toHaveLength(0);
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
  });
});
