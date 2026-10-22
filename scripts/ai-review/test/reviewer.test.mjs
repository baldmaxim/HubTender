import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combineAssessments } from '../lib/combine.mjs';
import { ConfigError } from '../lib/env.mjs';
import { createLlmClient } from '../lib/llm.mjs';
import { buildSystemPrompt, loadPromptTemplate } from '../lib/prompt.mjs';
import { planLimits, RESPONSE_SCHEMA, reviewItems, reviewPass, selectThinkTargets } from '../lib/reviewer.mjs';
import { makeProfile, sendJson, startServer } from './helpers.mjs';

const SYSTEM = 'СИСТЕМНЫЙ ПРОМПТ';
const FAST = { retryDelaysMs: [], sleep: async () => {} };
const COMMON = { system: SYSTEM, promptVersion: 'review-v1@test', skillsRev: 'none' };

const mkItem = (n, { money = null } = {}) => ({
  position: {
    id: `pos-${n}`, itemNo: `${n}`, customerName: `Позиция ${n}`, unit: 'м2',
    rows: [{ id: `row-${n}`, type: 'мат', name: `Материал ${n}`, unit: 'м3', quantity: '5', unitRate: '100' }],
  },
  findings: [{
    id: `fnd-${n}`, ruleCode: 'QA', ruleTitle: 'Нулевая цена', detail: `без цены ${n}`,
    entityType: 'boq_item', entityId: `row-${n}`, fingerprint: `fp-${n}`, moneyDelta: money,
  }],
});

const completion = (content) => ({
  model: 'm',
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

/** Находки из текста запроса: [{ ref, detail }]. */
const findingsOf = (body) => {
  const text = body.messages.at(-1).content;
  return [...text.matchAll(/^(f\d+) \| \S+ \| (?:r\d+)? ?\| (.*)$/gm)].map((m) => ({ ref: m[1], detail: m[2] }));
};

const assessment = (finding, label = 'likely_error') => ({
  finding: finding.ref,
  label,
  reason: `причина ${finding.ref}`,
  evidence: label === 'unsure' ? [] : [{ ref: `${finding.ref}.detail`, value: finding.detail }],
  basis: '',
});

/** Сервер-модель: respond(body, n, findings) → ответ либо undefined (штатный: все likely_error). */
const startModel = (respond = () => undefined) =>
  startServer((_req, res, body, n) => {
    if (_req.url.endsWith('/models')) return sendJson(res, 200, { data: [] });
    const found = findingsOf(body);
    const custom = respond(body, n, found);
    if (custom !== undefined) return sendJson(res, 200, completion(custom));
    return sendJson(res, 200, completion({ assessments: found.map((f) => assessment(f)) }));
  });

const withTmp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const setup = async (respond, profilePatch) => {
  const srv = await startModel(respond);
  const profile = makeProfile(srv.url, profilePatch);
  return { srv, profile, client: createLlmClient(profile, FAST) };
};

test('пачка разобрана одним запросом; запрос устроен как задумано', async () => {
  const { srv, profile, client } = await setup();
  try {
    const progress = [];
    const items = [mkItem(1), mkItem(2), mkItem(3)];
    const { results, usage } = await reviewPass({ client, profile, ...COMMON, items, onProgress: (l) => progress.push(l) });
    assert.equal(srv.calls.length, 1);
    assert.equal(usage.requests, 1);
    assert.equal(usage.promptTokens, 100);
    const body = srv.calls[0].body;
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.startsWith(SYSTEM));
    assert.match(body.messages[1].content, /^Данные позиций и находки:\n\nПравила:/);
    assert.equal(body.response_format.type, 'json_schema');
    assert.deepEqual(body.response_format.json_schema.schema, RESPONSE_SCHEMA);
    assert.equal(body.max_tokens, 200 * 3 + 1000);
    for (const n of [1, 2, 3]) {
      const a = results.get(`fnd-${n}`);
      assert.equal(a.status, 'ok');
      assert.equal(a.label, 'likely_error');
      assert.equal(a.think, false);
      assert.deepEqual(a.evidence, [{
        ref: `f${n}.detail`, field: 'detail', entity: 'finding', entityId: `fnd-${n}`, value: `без цены ${n}`, label: 'находка',
      }]);
    }
    assert.ok(progress.some((l) => /^qwen: пачка 1\/1 · 3 находок · ~\d+ тыс\. токенов · \d+ с$/.test(l)), progress.join('\n'));
  } finally {
    srv.close();
  }
});

test('evidence по строке и позиции хранится устойчиво: id сущности и подпись', async () => {
  const { srv, profile, client } = await setup((_body, _n, found) => ({
    assessments: found.map((f) => ({
      ...assessment(f),
      evidence: [{ ref: 'r1.unit_rate', value: '100' }, { ref: 'p1.customer_name', value: 'Позиция 1' }],
    })),
  }));
  try {
    const { results } = await reviewPass({ client, profile, ...COMMON, items: [mkItem(1)] });
    const evidence = results.get('fnd-1').evidence;
    assert.deepEqual(evidence[0], { ref: 'r1.unit_rate', field: 'unit_rate', entity: 'row', entityId: 'row-1', value: '100', label: 'Материал 1' });
    assert.deepEqual(evidence[1], { ref: 'p1.customer_name', field: 'customer_name', entity: 'position', entityId: 'pos-1', value: 'Позиция 1', label: 'позиция' });
  } finally {
    srv.close();
  }
});

test('пропущенная находка — один дозапрос только по ней; снова нет — status missing', async () => {
  let again = false;
  const { srv, profile, client } = await setup((_body, n, found) => {
    if (n === 1) return { assessments: found.slice(0, 2).map((f) => assessment(f)) };
    if (again) return { assessments: [] };
    return undefined;
  });
  try {
    const items = [mkItem(1), mkItem(2), mkItem(3)];
    const first = await reviewPass({ client, profile, ...COMMON, items });
    assert.equal(srv.calls.length, 2);
    const second = srv.calls[1].body.messages[1].content;
    assert.equal(findingsOf(srv.calls[1].body).length, 1);
    assert.match(second, /без цены 3/);
    assert.ok(!/без цены 1/.test(second));
    assert.equal(first.results.get('fnd-3').status, 'ok');
    assert.equal(first.results.get('fnd-3').evidence[0].entityId, 'fnd-3'); // ссылки дозапроса перенумерованы верно

    again = true;
    const calls = srv.calls.length;
    const miss = await reviewPass({ client, profile, ...COMMON, items });
    assert.equal(srv.calls.length - calls, 2);
    const lost = miss.results.get('fnd-3');
    assert.equal(lost.status, 'missing');
    assert.equal(lost.label, 'unsure');
  } finally {
    srv.close();
  }
});

test('не-JSON: повтор, затем деление пачки пополам; одиночная позиция → error', async () => {
  const { srv, profile, client } = await setup((body, _n, found) => {
    if (found.length > 1) return 'это не JSON';
    if (/без цены 2/.test(body.messages[1].content)) return 'снова мусор';
    return undefined;
  });
  try {
    const items = [mkItem(1), mkItem(2), mkItem(3)];
    const { results } = await reviewPass({ client, profile, ...COMMON, items });
    // 3 поз.: 2 попытки; 2+1: пара (1,2) — 2 попытки и деление; поз. 1 — 1; поз. 2 — 2 попытки; поз. 3 — 1.
    assert.equal(srv.calls.length, 2 + 2 + 1 + 2 + 1);
    assert.equal(results.get('fnd-1').status, 'ok');
    assert.equal(results.get('fnd-3').status, 'ok');
    const bad = results.get('fnd-2');
    assert.equal(bad.status, 'error');
    assert.equal(bad.label, 'unsure');
    assert.match(bad.reason, /не разобран/);
  } finally {
    srv.close();
  }
});

test('JSON не по схеме тоже повторяется', async () => {
  const { srv, profile, client } = await setup((_body, n, found) => (n === 1 ? { foo: 1 } : undefined));
  try {
    const { results } = await reviewPass({ client, profile, ...COMMON, items: [mkItem(1)] });
    assert.equal(srv.calls.length, 2);
    assert.equal(results.get('fnd-1').status, 'ok');
  } finally {
    srv.close();
  }
});

test('кэш: повторный прогон без запросов, --no-cache читает заново, запись при этом идёт', async () => {
  const { srv, profile, client } = await setup();
  try {
    await withTmp(async (dir) => {
      const cache = { read: true, write: true, dir };
      const items = [mkItem(1), mkItem(2)];
      await reviewPass({ client, profile, ...COMMON, items, cache });
      assert.equal(srv.calls.length, 1);
      assert.equal(readdirSync(join(dir, 'cache', 'qwen')).filter((f) => f.endsWith('.json')).length, 2);
      assert.equal(readdirSync(join(dir, 'cache', 'qwen')).filter((f) => f.endsWith('.tmp')).length, 0);

      const again = await reviewPass({ client, profile, ...COMMON, items, cache });
      assert.equal(srv.calls.length, 1);
      assert.equal(again.usage.cachedPositions, 2);
      assert.equal(again.results.get('fnd-1').status, 'ok');
      assert.equal(again.results.get('fnd-1').evidence[0].entityId, 'fnd-1');

      // Одна позиция новая — спрашиваем только её.
      await reviewPass({ client, profile, ...COMMON, items: [...items, mkItem(3)], cache });
      assert.equal(srv.calls.length, 2);
      assert.equal(findingsOf(srv.calls[1].body).length, 1);

      // Другая версия промпта / ревизия навыков / отпечаток — другой ключ.
      await reviewPass({ client, profile, ...COMMON, promptVersion: 'review-v1@other', items, cache });
      assert.equal(srv.calls.length, 3);
      await reviewPass({ client, profile, ...COMMON, skillsRev: 'abc', items, cache });
      assert.equal(srv.calls.length, 4);

      const noRead = await reviewPass({ client, profile, ...COMMON, items, cache: { read: false, write: true, dir } });
      assert.equal(srv.calls.length, 5);
      assert.equal(noRead.usage.cachedPositions, 0);
    });
  } finally {
    srv.close();
  }
});

test('сбой модели (LlmError): проход остановлен, полученное сохранено в кэше, остальное — error', async () => {
  const { srv, profile, client } = await setup();
  srv.close();
  const failing = await startServer((req, res, body, n) => {
    if (n === 1) return sendJson(res, 200, completion({ assessments: findingsOf(body).map((f) => assessment(f)) }));
    return sendJson(res, 401, { error: { message: 'bad key' } });
  });
  try {
    await withTmp(async (dir) => {
      const p = makeProfile(failing.url, { batchFindings: 1 });
      const c = createLlmClient(p, FAST);
      const items = [mkItem(1), mkItem(2), mkItem(3)];
      const { results } = await reviewPass({ client: c, profile: p, ...COMMON, items, cache: { read: true, write: true, dir } });
      assert.equal(failing.calls.length, 2); // третья пачка не запрашивалась
      assert.equal(results.get('fnd-1').status, 'ok');
      for (const id of ['fnd-2', 'fnd-3']) {
        assert.equal(results.get(id).status, 'error');
        assert.match(results.get(id).reason, /HTTP 401/);
      }
      assert.equal(readdirSync(join(dir, 'cache', 'qwen')).length, 1);
    });
  } finally {
    failing.close();
  }
});

test('think: заменяет unsure и крупнейших по |Δ|; без thinkExtra — пропуск с сообщением', async () => {
  const respond = (body, _n, found) => {
    const thinking = body.chat_template_kwargs?.enable_thinking === true;
    return {
      assessments: found.map((f) => assessment(f, thinking ? 'likely_ok' : f.detail.endsWith('1') ? 'unsure' : 'likely_error')),
    };
  };
  const { srv, profile, client } = await setup(respond, {
    extra: { chat_template_kwargs: { enable_thinking: false } },
    thinkExtra: { chat_template_kwargs: { enable_thinking: true } },
  });
  try {
    const items = [mkItem(1), mkItem(2, { money: 5000 }), mkItem(3)];
    const { results, usage } = await reviewItems({ client, profile, ...COMMON, items, think: true });
    assert.equal(srv.calls.length, 2);
    assert.equal(srv.calls[0].body.max_tokens, 200 * 3 + 1000);
    assert.equal(srv.calls[1].body.max_tokens, 200 * 2 + 1000 + 3000);
    assert.deepEqual(findingsOf(srv.calls[1].body).map((f) => f.detail), ['без цены 1', 'без цены 2']);
    assert.equal(results.get('fnd-1').label, 'likely_ok');
    assert.equal(results.get('fnd-1').think, true);
    assert.equal(results.get('fnd-2').label, 'likely_ok'); // дорогая находка перепроверена
    assert.equal(results.get('fnd-2').think, true);
    assert.equal(results.get('fnd-3').label, 'likely_error'); // не трогали
    assert.equal(results.get('fnd-3').think, false);
    assert.equal(usage.requests, 2);

    const noThink = makeProfile(srv.url);
    const lines = [];
    const before = srv.calls.length;
    const res = await reviewItems({ client: createLlmClient(noThink, FAST), profile: noThink, ...COMMON, items, think: true, onProgress: (l) => lines.push(l) });
    assert.equal(srv.calls.length - before, 1);
    assert.ok(lines.some((l) => /--think пропущен.*AI_REVIEW_QWEN_THINK_EXTRA/.test(l)), lines.join('\n'));
    assert.equal(res.results.get('fnd-1').think, false);
  } finally {
    srv.close();
  }
});

test('think: unsure после второго прохода не заменяет первую оценку', async () => {
  const { srv, profile, client } = await setup(
    (body, _n, found) => ({ assessments: found.map((f) => assessment(f, body.chat_template_kwargs ? 'unsure' : 'likely_error')) }),
    { thinkExtra: { chat_template_kwargs: { enable_thinking: true } } },
  );
  try {
    const { results } = await reviewItems({ client, profile, ...COMMON, items: [mkItem(1, { money: 10 })], think: true });
    assert.equal(srv.calls.length, 2);
    assert.equal(results.get('fnd-1').label, 'likely_error');
    assert.equal(results.get('fnd-1').think, false);
  } finally {
    srv.close();
  }
});

test('selectThinkTargets: сбойные не берутся, 20 крупнейших по |Δ|', () => {
  const items = Array.from({ length: 30 }, (_, i) => mkItem(i + 1, { money: (i + 1) * 100 }));
  const results = new Map(items.map((it) => [it.findings[0].id, { label: 'likely_ok', status: 'ok' }]));
  results.set('fnd-30', { label: 'unsure', status: 'error' });
  results.set('fnd-1', { label: 'unsure', status: 'ok' });
  const picked = selectThinkTargets(items, results).map((it) => it.findings[0].id);
  assert.equal(picked.length, 21); // 20 крупнейших (кроме сбойного №30) + №1 unsure → 20 + 1
  assert.ok(picked.includes('fnd-1'));
  assert.ok(!picked.includes('fnd-30'));
  assert.ok(picked.includes('fnd-29'));
});

test('planLimits: бюджет, maxFindings, мало контекста', () => {
  const p = makeProfile('http://x', { contextTokens: 16384, maxTokens: 8192, batchFindings: 60 });
  const plain = planLimits(p, 'abc', false);
  assert.equal(plain.maxFindings, 35); // floor((8192 − 1000) / 200)
  assert.equal(plain.perFindingTokens, 200);
  assert.ok(plain.budgetTokens > 15000 && plain.budgetTokens < 16384 - 1024 + 1);
  const think = planLimits(p, 'abc', true);
  assert.equal(think.maxFindings, 20); // (8192 − 4000) / 200 = 20,96
  assert.equal(plain.budgetTokens - think.budgetTokens, 3000);
  assert.equal(planLimits({ ...p, batchFindings: 5 }, 'abc', false).maxFindings, 5);
  assert.equal(planLimits({ ...p, maxTokens: 500 }, 'abc', false).maxFindings, 1);
  assert.throws(() => planLimits({ ...p, contextTokens: 2000 }, 'abc', false), (err) => err instanceof ConfigError && /Мало контекста/.test(err.message));
});

test('combine: согласие, расхождение, одна модель, сбои', () => {
  const ok = (label, reason, basis = '') => ({ label, reason, basis, status: 'ok' });
  assert.deepEqual(
    combineAssessments({ qwen: ok('likely_error', 'a', 'P-1'), minimax: ok('likely_error', 'b') }),
    { label: 'likely_error', reason: 'a', basis: 'P-1', agree: true },
  );
  assert.deepEqual(
    combineAssessments({ qwen: ok('likely_error', 'цены нет'), minimax: ok('likely_ok', 'бесплатно') }),
    { label: 'unsure', reason: 'модели расходятся: qwen — ошибка: цены нет; minimax — норма: бесплатно', basis: '', agree: false },
  );
  assert.deepEqual(combineAssessments({ qwen: ok('likely_ok', 'x') }), { label: 'likely_ok', reason: 'x', basis: '', agree: true });
  const failed = { label: 'unsure', reason: 'сбой', basis: '', status: 'error' };
  assert.deepEqual(combineAssessments({ qwen: failed, minimax: ok('likely_ok', 'x') }), { label: 'likely_ok', reason: 'x', basis: '', agree: true });
  assert.deepEqual(combineAssessments({ qwen: failed }), { label: 'unsure', reason: 'сбой', basis: '', agree: true });
});

test('prompt: версия по sha256 файла, подстановка навыков', () => {
  const { template, version } = loadPromptTemplate();
  assert.match(version, /^review-v1@[0-9a-f]{8}$/);
  assert.ok(template.includes('{{SKILLS}}'));
  assert.ok(buildSystemPrompt(template, '').trimEnd().endsWith('Навыков пока нет.'));
  const withSkills = buildSystemPrompt(template, 'GA-1: $& не менять');
  assert.ok(withSkills.trimEnd().endsWith('GA-1: $& не менять'));
  assert.ok(!withSkills.includes('{{SKILLS}}'));
});
