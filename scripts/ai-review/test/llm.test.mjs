import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLlmClient, extractJson, LlmError, normalizeBaseUrl, stripThinking } from '../lib/llm.mjs';

/** Фейковый сервер чата: handler(body, req, res, n). */
const startServer = async (handler) => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ url: req.url, headers: req.headers, body });
      handler(body, req, res, calls.length);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => server.close() };
};

const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const completion = (message, extra = {}) => ({
  model: 'm',
  choices: [{ message, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } },
  ...extra,
});

const makeProfile = (baseUrl, patch = {}) => ({
  name: 'qwen',
  baseUrl,
  apiKey: '',
  model: 'm',
  contextTokens: 16384,
  timeoutMs: 5000,
  maxTokens: 100,
  extra: undefined,
  ...patch,
});
const FAST = { retryDelaysMs: [1, 1, 1], sleep: async () => {} };
const SCHEMA = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false };
const MESSAGES = [{ role: 'user', content: 'Сколько 17+25?' }];

test('цепочка форматов json_schema -> json_object -> без формата, формат запоминается', async () => {
  const srv = await startServer((body, _req, res, n) => {
    if (n === 1 && body.response_format?.type === 'json_schema') return reply(res, 400, { error: { message: 'no schema' } });
    if (n === 2 && body.response_format?.type === 'json_object') return reply(res, 404, { error: { message: 'no provider' } });
    return reply(res, 200, completion({ content: '{"answer":42}' }));
  });
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), FAST);
    const first = await client.chat({ messages: MESSAGES, schema: SCHEMA });
    assert.deepEqual(first.json, { answer: 42 });
    assert.equal(first.format, 'none');
    assert.equal(srv.calls.length, 3);
    assert.equal(srv.calls[2].body.response_format, undefined);

    const second = await client.chat({ messages: MESSAGES, schema: SCHEMA });
    assert.equal(second.format, 'none');
    assert.equal(srv.calls.length, 4);
    const sent = srv.calls[3].body;
    assert.equal(sent.response_format, undefined);
    assert.equal(sent.messages[0].role, 'system');
    assert.match(sent.messages[0].content, /Ответ — только JSON по схеме:\n.*"answer"/);
    assert.equal(sent.stream, false);
    assert.equal(sent.temperature, 0);
    assert.equal(sent.max_tokens, 100);
  } finally {
    srv.close();
  }
});

test('json_schema: тело запроса, usage, без ключа нет Authorization', async () => {
  const srv = await startServer((_body, _req, res) => reply(res, 200, completion({ content: '{"answer":42}' })));
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl, { extra: { chat_template_kwargs: { enable_thinking: false } } }), FAST);
    const res = await client.chat({ messages: MESSAGES, schema: SCHEMA, schemaName: 'calc' });
    assert.equal(res.format, 'json_schema');
    assert.deepEqual(res.usage, { promptTokens: 10, completionTokens: 5, reasoningTokens: 3 });
    const { body, headers } = srv.calls[0];
    assert.equal(body.response_format.json_schema.name, 'calc');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(headers.authorization, undefined);
    assert.equal(headers['accept-encoding'], 'identity');
  } finally {
    srv.close();
  }
});

test('ключ задан -> Bearer', async () => {
  const srv = await startServer((_b, _r, res) => reply(res, 200, { data: [{ id: 'a' }, { id: 'b' }] }));
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl, { apiKey: 'sk-test' }), FAST);
    assert.deepEqual(await client.listModels(), ['a', 'b']);
    assert.equal(srv.calls[0].headers.authorization, 'Bearer sk-test');
    assert.equal(srv.calls[0].url, '/v1/models');
  } finally {
    srv.close();
  }
});

test('429 с Retry-After: 0 -> повтор', async () => {
  const sleeps = [];
  const srv = await startServer((_b, _r, res, n) =>
    n === 1 ? reply(res, 429, { error: 'slow' }, { 'Retry-After': '0' }) : reply(res, 200, completion({ content: 'ok' })),
  );
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), { retryDelaysMs: [999], sleep: async (ms) => sleeps.push(ms) });
    const res = await client.chat({ messages: MESSAGES });
    assert.equal(res.content, 'ok');
    assert.deepEqual(sleeps, [0]);
  } finally {
    srv.close();
  }
});

test('200 с {error:{code:503}} -> повтор; после исчерпания LlmError со status', async () => {
  const srv = await startServer((_b, _r, res, n) =>
    n === 1 ? reply(res, 200, { error: { code: 503, message: 'overloaded' } }) : reply(res, 200, completion({ content: 'ok' })),
  );
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), FAST);
    assert.equal((await client.chat({ messages: MESSAGES })).content, 'ok');
  } finally {
    srv.close();
  }
  const bad = await startServer((_b, _r, res) => reply(res, 500, { error: { message: 'boom' } }));
  try {
    const client = createLlmClient(makeProfile(bad.baseUrl), FAST);
    await assert.rejects(client.chat({ messages: MESSAGES }), (err) => err instanceof LlmError && err.status === 500 && err.kind === 'http');
    assert.equal(bad.calls.length, 4); // 1 + 3 повтора
  } finally {
    bad.close();
  }
});

test('рассуждения: <think>, </think> без открывающего, незакрытый <think>, reasoning_content', async () => {
  assert.deepEqual(stripThinking('<think>думаю</think>\n{"a":1}'), { content: '{"a":1}', reasoning: 'думаю' });
  assert.deepEqual(stripThinking('долго думаю\n</think>\n{"a":1}'), { content: '{"a":1}', reasoning: 'долго думаю' });
  assert.deepEqual(stripThinking('<THINK>раз</THINK>A<think>два</think>B'), { content: 'AB', reasoning: 'раз\n\nдва' });
  assert.deepEqual(stripThinking('начало<think>обрыв без конца'), { content: 'начало', reasoning: 'обрыв без конца' });
  assert.deepEqual(stripThinking('просто текст'), { content: 'просто текст', reasoning: '' });

  const srv = await startServer((_b, _r, res) =>
    reply(res, 200, completion({ content: null, reasoning_content: 'мысли' }, {})),
  );
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), FAST);
    const res = await client.chat({ messages: MESSAGES });
    assert.equal(res.content, '');
    assert.equal(res.reasoning, 'мысли');
  } finally {
    srv.close();
  }
});

test('extractJson: ```json-блок, префикс, мусор', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Вот ответ:\n```json\n{"a": 2}\n```\nготово'), { a: 2 });
  assert.deepEqual(extractJson('```\n{"a": 3}\n```'), { a: 3 });
  assert.deepEqual(extractJson('Ответ: {"a": 4} спасибо'), { a: 4 });
  assert.equal(extractJson('нет json'), undefined);
  assert.equal(extractJson('{битый'), undefined);
});

test('finish_reason length -> parseError, json undefined', async () => {
  const srv = await startServer((_b, _r, res) =>
    reply(res, 200, { choices: [{ message: { content: '{"answer": 4' }, finish_reason: 'length' }], usage: {} }),
  );
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), FAST);
    const res = await client.chat({ messages: MESSAGES, schema: SCHEMA });
    assert.equal(res.json, undefined);
    assert.equal(res.parseError, 'ответ обрезан по max_tokens');
    assert.equal(res.finishReason, 'length');
  } finally {
    srv.close();
  }
});

test('таймаут -> LlmError kind timeout без повторов', async () => {
  const srv = await startServer(() => {
    // сервер молчит
  });
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl, { timeoutMs: 200 }), FAST);
    await assert.rejects(client.chat({ messages: MESSAGES }), (err) => {
      return err instanceof LlmError && err.kind === 'timeout' && /AI_REVIEW_QWEN_TIMEOUT_SEC/.test(err.message);
    });
    assert.equal(srv.calls.length, 1);
  } finally {
    srv.close();
    srv.close = () => {};
  }
});

test('нормализация baseUrl', () => {
  assert.equal(normalizeBaseUrl('http://pc:11434'), 'http://pc:11434/v1');
  assert.equal(normalizeBaseUrl('http://pc:11434/'), 'http://pc:11434/v1');
  assert.equal(normalizeBaseUrl('https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1');
});

test('think: thinkExtra вливается поверх extra только при think=true', async () => {
  const srv = await startServer((_b, _r, res) => reply(res, 200, completion({ content: 'ok' })));
  try {
    const profile = makeProfile(srv.baseUrl, {
      extra: { chat_template_kwargs: { enable_thinking: false }, top_k: 5 },
      thinkExtra: { chat_template_kwargs: { enable_thinking: true } },
    });
    const client = createLlmClient(profile, FAST);
    await client.chat({ messages: MESSAGES });
    await client.chat({ messages: MESSAGES, think: true });
    assert.deepEqual(srv.calls[0].body.chat_template_kwargs, { enable_thinking: false });
    assert.deepEqual(srv.calls[1].body.chat_template_kwargs, { enable_thinking: true });
    assert.equal(srv.calls[1].body.top_k, 5);
  } finally {
    srv.close();
  }
});

test('think=true без thinkExtra в профиле — тело как обычно', async () => {
  const srv = await startServer((_b, _r, res) => reply(res, 200, completion({ content: 'ok' })));
  try {
    const client = createLlmClient(makeProfile(srv.baseUrl), FAST);
    await client.chat({ messages: MESSAGES, think: true });
    assert.equal(srv.calls[0].body.chat_template_kwargs, undefined);
  } finally {
    srv.close();
  }
});
