import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combineAssessments } from '../lib/combine.mjs';
import { ConfigError } from '../lib/env.mjs';
import { createLlmClient } from '../lib/llm.mjs';
import { buildSystemPrompt, loadPromptTemplate, prepareSystem } from '../lib/prompt.mjs';
import { addUsage, newUsage, planLimits, RESPONSE_SCHEMA, reviewItems, reviewPass, selectThinkTargets } from '../lib/reviewer.mjs';
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
    assert.equal(body.max_tokens, profile.maxTokens); // всегда потолок профиля
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
    assert.equal(srv.calls[0].body.max_tokens, profile.maxTokens);
    assert.equal(srv.calls[1].body.max_tokens, profile.maxTokens);
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
  assert.equal(plain.maxFindings, 17); // floor((8192 − 1000) / 400)
  assert.equal(plain.perFindingTokens, 400);
  assert.equal(plain.perPositionTokens, 500);
  assert.equal(plain.maxAnswerTokens, 8192 - 1000);
  assert.ok(plain.budgetTokens > 15000 && plain.budgetTokens < 16384 - 1024 + 1);
  const think = planLimits(p, 'abc', true);
  assert.equal(think.maxFindings, 10); // (8192 − 4000) / 400 = 10,48
  assert.equal(plain.budgetTokens - think.budgetTokens, 3000);
  assert.equal(think.maxAnswerTokens, 8192 - 1000 - 3000);
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

// --- собственные замечания ----------------------------------------------------

/** Позиция без находок: данные нужны модели только для своих замечаний. */
const mkBare = (n) => ({ ...mkItem(n), findings: [] });

const REMARK_CODES = new Set(['AI-001', 'AI-002']);
const RULE_CODES = new Set(['QA']);
const REMARK_OPTS = { remarkCodes: REMARK_CODES, ruleCodes: RULE_CODES };

/** Позиции пачки по порядку: p1 — первая и т. д.; строка позиции — r<k> (по одной на позицию). */
const remarkFor = (k, over = {}) => ({
  position: `p${k}`, row: `r${k}`, type: 'AI-001', title: '', detail: `Замечание по позиции ${k}`,
  evidence: [{ ref: `r${k}.name`, value: `Материал ${k}` }], ...over,
});

const assessmentsOf = (found) => found.map((f) => assessment(f));

test('замечания: из ответа на пачку, для позиций с находками и без, в устойчивом виде; usage', async () => {
  const { srv, profile, client } = await setup((body, _n, found) => ({
    assessments: assessmentsOf(found),
    remarks: [
      remarkFor(1),
      remarkFor(2, { type: 'NEW', title: 'Новый тип', row: '' , evidence: [{ ref: 'p2.customer_name', value: 'Позиция 2' }] }),
      remarkFor(2, { type: 'QA' }), // код скриптового правила
      remarkFor(3, { evidence: [{ ref: 'r3.name', value: 'выдумано' }] }), // факт не подтверждён
    ],
  }));
  try {
    const items = [mkItem(1), mkBare(2), mkBare(3)];
    const { results, remarks, usage } = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items });
    assert.equal(srv.calls.length, 1);
    assert.equal(srv.calls[0].body.max_tokens, profile.maxTokens);
    assert.equal(srv.calls[0].body.messages[1].content.split('findings:').length - 1, 1); // у p2 и p3 строки findings: нет
    assert.equal(results.size, 1);
    assert.deepEqual([...remarks.keys()], ['pos-1', 'pos-2']);
    assert.deepEqual(remarks.get('pos-1'), [{
      type: 'AI-001', title: '', positionId: 'pos-1', rowId: 'row-1', detail: 'Замечание по позиции 1',
      evidence: [{ ref: 'r1.name', field: 'name', entity: 'row', entityId: 'row-1', value: 'Материал 1', label: 'Материал 1' }],
    }]);
    const second = remarks.get('pos-2')[0];
    assert.equal(second.type, 'NEW');
    assert.equal(second.title, 'Новый тип');
    assert.equal(second.rowId, null);
    assert.deepEqual(second.evidence[0], { ref: 'p2.customer_name', field: 'customer_name', entity: 'position', entityId: 'pos-2', value: 'Позиция 2', label: 'позиция' });
    assert.equal(usage.remarks, 2);
    assert.equal(usage.remarksDropped, 2);
    assert.equal(usage.remarkPositionsFailed, 0);
  } finally {
    srv.close();
  }
});

test('замечания: ответ без remarks (json_object) — не ошибка, замечаний нет', async () => {
  const { srv, profile, client } = await setup((_b, _n, found) => ({ assessments: assessmentsOf(found) }));
  try {
    const { results, remarks, usage } = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items: [mkItem(1), mkBare(2)] });
    assert.equal(srv.calls.length, 1);
    assert.equal(results.get('fnd-1').status, 'ok');
    assert.equal(remarks.size, 0);
    assert.equal(usage.remarkPositionsFailed, 0);
  } finally {
    srv.close();
  }
});

test('замечания: схема ответа требует remarks; newUsage/addUsage несут счётчики замечаний', () => {
  assert.deepEqual(RESPONSE_SCHEMA.required, ['assessments', 'remarks']);
  const item = RESPONSE_SCHEMA.properties.remarks.items;
  assert.deepEqual(item.required, ['position', 'row', 'type', 'title', 'detail', 'evidence']);
  assert.equal(item.additionalProperties, false);
  const total = addUsage(newUsage(), { remarks: 2, remarksDropped: 1, remarkPositionsFailed: 3, requests: 1 });
  assert.deepEqual([total.remarks, total.remarksDropped, total.remarkPositionsFailed, total.requests], [2, 1, 3, 1]);
});

test('замечания: позиция без находок и без ответа (сбой разбора) — remarkPositionsFailed, в кэш не пишется', async () => {
  const { srv, profile, client } = await setup(() => 'не JSON');
  try {
    await withTmp(async (dir) => {
      const { remarks, usage, results } = await reviewPass({
        client, profile, ...COMMON, ...REMARK_OPTS, items: [mkBare(1), mkBare(2)], cache: { read: true, write: true, dir },
      });
      assert.equal(results.size, 0);
      assert.equal(remarks.size, 0);
      assert.equal(usage.remarkPositionsFailed, 2);
      assert.equal(usage.remarks, 0);
      assert.equal(existsSync(join(dir, 'cache', 'qwen')), false);
    });
  } finally {
    srv.close();
  }
});

test('замечания: из дозапроса пропущенных находок не берутся', async () => {
  const { srv, profile, client } = await setup((_b, n, found) => {
    if (n === 1) return { assessments: [], remarks: [remarkFor(1)] }; // находка пропущена
    return { assessments: assessmentsOf(found), remarks: [remarkFor(1, { detail: 'из дозапроса' })] };
  });
  try {
    const { results, remarks, usage } = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items: [mkItem(1)] });
    assert.equal(srv.calls.length, 2);
    assert.equal(results.get('fnd-1').status, 'ok');
    assert.deepEqual(remarks.get('pos-1').map((r) => r.detail), ['Замечание по позиции 1']);
    assert.equal(usage.remarks, 1);
    assert.equal(usage.remarksDropped, 0);
  } finally {
    srv.close();
  }
});

test('замечания: после деления пачки пополам берутся из ответа на половину', async () => {
  const { srv, profile, client } = await setup((body, _n, found) => {
    const text = body.messages[1].content;
    if (/Позиция 2/.test(text) && /Позиция 1/.test(text)) return 'мусор'; // вся пачка
    const material = /Материал (\d+)/.exec(text)[1];
    return { assessments: assessmentsOf(found), remarks: [remarkFor(1, { evidence: [{ ref: 'r1.name', value: `Материал ${material}` }] })] };
  });
  try {
    const { remarks } = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items: [mkItem(1), mkBare(2)] });
    // половины: [поз. 1] и [поз. 2]; каждая пачка — свой p1/r1
    assert.deepEqual([...remarks.keys()].sort(), ['pos-1', 'pos-2']);
    assert.equal(remarks.get('pos-2')[0].rowId, 'row-2');
  } finally {
    srv.close();
  }
});

test('кэш: хранит { assessments, remarks }; позиция без находок берётся из кэша; повторный прогон без запросов', async () => {
  const { srv, profile, client } = await setup((_b, _n, found) => ({ assessments: assessmentsOf(found), remarks: [remarkFor(1), remarkFor(2)] }));
  try {
    await withTmp(async (dir) => {
      const cache = { read: true, write: true, dir };
      const items = [mkItem(1), mkBare(2)];
      const first = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(srv.calls.length, 1);
      const files = readdirSync(join(dir, 'cache', 'qwen')).filter((f) => f.endsWith('.json'));
      assert.equal(files.length, 2);
      const stored = JSON.parse(readFileSync(join(dir, 'cache', 'qwen', files[0]), 'utf8'));
      assert.ok(Array.isArray(stored.assessments));
      assert.ok(Array.isArray(stored.remarks));

      const again = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(srv.calls.length, 1);
      assert.equal(again.usage.cachedPositions, 2);
      assert.equal(again.usage.askedPositions, 0);
      assert.equal(again.results.get('fnd-1').status, 'ok');
      assert.deepEqual(again.remarks, first.remarks);
      assert.equal(again.usage.remarks, 2);
    });
  } finally {
    srv.close();
  }
});

test('кэш: запись старого формата (только оценки) — промах', async () => {
  const { srv, profile, client } = await setup();
  try {
    await withTmp(async (dir) => {
      const cache = { read: true, write: true, dir };
      const items = [mkItem(1), mkBare(2)];
      await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(srv.calls.length, 1);
      const folder = join(dir, 'cache', 'qwen');
      for (const f of readdirSync(folder)) {
        const data = JSON.parse(readFileSync(join(folder, f), 'utf8'));
        writeFileSync(join(folder, f), JSON.stringify({ v: 1, assessments: data.assessments }), 'utf8'); // как раньше
      }
      const again = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(again.usage.cachedPositions, 0);
      assert.equal(again.usage.askedPositions, 2);
      assert.equal(srv.calls.length, 2);

      // совсем старый вид — голый массив — тоже промах
      for (const f of readdirSync(folder)) writeFileSync(join(folder, f), JSON.stringify([]), 'utf8');
      const third = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(third.usage.cachedPositions, 0);
      assert.equal(srv.calls.length, 3);
    });
  } finally {
    srv.close();
  }
});

test('кэш: позиция с находкой status не ok не считается полной, даже если remarks есть', async () => {
  const { srv, profile, client } = await setup();
  try {
    await withTmp(async (dir) => {
      const cache = { read: true, write: true, dir };
      const items = [mkItem(1)];
      await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      const folder = join(dir, 'cache', 'qwen');
      const [file] = readdirSync(folder);
      const data = JSON.parse(readFileSync(join(folder, file), 'utf8'));
      data.assessments[0].status = 'error';
      writeFileSync(join(folder, file), JSON.stringify(data), 'utf8');
      const again = await reviewPass({ client, profile, ...COMMON, ...REMARK_OPTS, items, cache });
      assert.equal(again.usage.cachedPositions, 0);
    });
  } finally {
    srv.close();
  }
});

test('think: замечания берутся только из первого прохода', async () => {
  const { srv, profile, client } = await setup(
    (body, _n, found) => {
      const thinking = body.chat_template_kwargs?.enable_thinking === true;
      return {
        assessments: found.map((f) => assessment(f, thinking ? 'likely_ok' : 'unsure')),
        remarks: [remarkFor(1, { detail: thinking ? 'из think-прохода' : 'из первого прохода' })],
      };
    },
    { thinkExtra: { chat_template_kwargs: { enable_thinking: true } } },
  );
  try {
    const { results, remarks, usage } = await reviewItems({ client, profile, ...COMMON, ...REMARK_OPTS, items: [mkItem(1, { money: 10 }), mkBare(2)], think: true });
    assert.equal(srv.calls.length, 2); // первый проход (одна пачка) и второй (позиции с находками)
    assert.equal(results.get('fnd-1').think, true);
    assert.deepEqual(remarks.get('pos-1').map((r) => r.detail), ['из первого прохода']);
    assert.equal(usage.remarks, 1); // только из первого прохода
    assert.equal(usage.remarksDropped, 0);
  } finally {
    srv.close();
  }
});

test('prepareSystem: типы замечаний идут в промпт всегда, remarkCodes — активные remark', async () => {
  const skills = await import('../lib/skills.mjs');
  const { system, remarkCodes } = prepareSystem({ ruleCodes: [], skills });
  assert.deepEqual([...remarkCodes], ['AI-001', 'AI-002', 'AI-003', 'AI-004']);
  assert.equal((system.match(/^### AI-\d{3} · /gm) ?? []).length, 4);
  assert.match(system, /## Свои замечания/);
  assert.match(system, /У части позиций находок нет/);
  // снятая запись не попадает в remarkCodes
  const retired = {
    ...skills,
    loadSkills: () => ({ rev: 'x', path: '', entries: [
      { code: 'AI-001', title: 'A', kind: 'remark', rule: null, status: 'active', auto: 'no', body: 'x' },
      { code: 'AI-002', title: 'B', kind: 'remark', rule: null, status: 'retired', auto: 'no', body: 'y' },
      { code: 'GA', title: 'C', kind: 'rule', rule: 'GA', status: 'active', auto: 'no', body: 'z' },
    ] }),
  };
  assert.deepEqual([...prepareSystem({ ruleCodes: ['GA'], skills: retired }).remarkCodes], ['AI-001']);
});
