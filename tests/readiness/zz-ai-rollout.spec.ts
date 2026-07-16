import { expect, test } from '@playwright/test';

// Этап 2.5 (§16/§28.14-15): финальная проверка rollout-off. Выполняется
// ПОСЛЕДНЕЙ (zz-префикс): после admin-flow (1 model test) и полного Smart
// Import прогона smoke.spec fake OpenRouter обязан насчитать РОВНО один
// chat-вызов — админский synthetic test. Любой пользовательский suggest
// с live-вызовом провайдера сломал бы этот счётчик.

const OR_STATS = process.env.E2E_OPENROUTER_STATS ?? '';

test('rollout off: chat-вызовов ровно 1 (только админский model test)', async ({ request }) => {
  test.skip(!OR_STATS, 'E2E_OPENROUTER_STATS не задан');
  const stats = await (await request.get(OR_STATS)).json();
  expect(stats.chat, `fake OpenRouter chat calls: ${JSON.stringify(stats)}`).toBe(1);
});
