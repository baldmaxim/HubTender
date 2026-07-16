import { expect, test } from '@playwright/test';

// Этапы 2.5/2.6 (§16/§28): финальная проверка провайдерского счётчика.
// Выполняется ПОСЛЕДНЕЙ (zz-префикс). Ожидаемые chat-вызовы за весь прогон:
//   1 — админский model test (ai-admin.spec);
//   3 — live evaluation, 21 кейс → 3 батча по ProviderBatchSize=8 (ai-pilot.spec);
//   1 — единственный пилотный suggest (ai-pilot.spec).
// Итого РОВНО 5. Ни smoke.spec (обычный пользователь), ни действия после
// emergency off не имеют права добавить ни одного вызова.

const OR_STATS = process.env.E2E_OPENROUTER_STATS ?? '';

test('провайдерский счётчик: ровно 5 chat-вызовов (test+eval+pilot)', async ({ request }) => {
  test.skip(!OR_STATS, 'E2E_OPENROUTER_STATS не задан');
  const stats = await (await request.get(OR_STATS)).json();
  expect(stats.chat, `fake OpenRouter chat calls: ${JSON.stringify(stats)}`).toBe(5);
});
