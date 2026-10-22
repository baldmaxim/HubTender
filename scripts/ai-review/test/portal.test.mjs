import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ConfigError } from '../lib/env.mjs';
import { createPortal, maskKey, PortalError } from '../lib/portal.mjs';

/** Фейковый портал: handler(req, res, hits) на 127.0.0.1:0. */
const startServer = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => server.close() };
};

const json = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(JSON.stringify(body));
};

const noSleep = async () => {};

test('конверт data, заголовки и query', async () => {
  const srv = await startServer((_req, res) => json(res, 200, { data: [1, 2] }));
  try {
    const portal = createPortal({ url: `${srv.url}/api/v1/`, key: 'thk_abcdef123', sleep: noSleep });
    assert.equal(portal.baseUrl, srv.url);
    const data = await portal.get('/api/v1/tenders/brief', { search: '', is_archived: 'false', skip: undefined });
    assert.deepEqual(data, [1, 2]);
    const req = srv.requests[0];
    assert.equal(req.url, '/api/v1/tenders/brief?search=&is_archived=false');
    assert.equal(req.headers['x-api-key'], 'thk_abcdef123');
    assert.equal(req.headers['accept-encoding'], 'gzip');
    assert.equal(req.headers.authorization, undefined);
  } finally {
    srv.close();
  }
});

test('204 -> null, объект без data возвращается целиком, POST с телом', async () => {
  const srv = await startServer((req, res, n) => {
    if (n === 1) {
      res.writeHead(204);
      res.end();
    } else if (n === 2) json(res, 200, { ok: true });
    else {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => json(res, 200, { data: JSON.parse(raw) }));
    }
  });
  try {
    const portal = createPortal({ url: srv.url, key: 'k', sleep: noSleep });
    assert.equal(await portal.put('/x', { a: 1 }), null);
    assert.deepEqual(await portal.get('/y'), { ok: true });
    assert.deepEqual(await portal.post('/z', { b: 2 }), { b: 2 });
    assert.equal(srv.requests[2].headers['content-type'], 'application/json');
  } finally {
    srv.close();
  }
});

test('HTML вместо JSON -> PortalError', async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>nginx</html>');
  });
  try {
    const portal = createPortal({ url: srv.url, key: 'k', sleep: noSleep });
    await assert.rejects(portal.get('/a'), (err) => err instanceof PortalError && /ответил не портал \(HTML\)/.test(err.message));
  } finally {
    srv.close();
  }
});

test('403 SCOPE_DENIED и 401 содержат подсказки', async () => {
  const srv = await startServer((_req, res, n) =>
    n === 1
      ? json(res, 403, { code: 'API_KEY_SCOPE_DENIED', detail: 'нет права', requiredScope: 'verification:read' }, 'application/problem+json')
      : json(res, 401, { title: 'invalid API key' }),
  );
  try {
    const portal = createPortal({ url: srv.url, key: 'k', sleep: noSleep });
    await assert.rejects(portal.get('/a'), (err) => err.status === 403 && err.code === 'API_KEY_SCOPE_DENIED' && /не хватает права verification:read/.test(err.message));
    await assert.rejects(portal.get('/b'), (err) => err.status === 401 && /X-API-Key/.test(err.message));
  } finally {
    srv.close();
  }
});

test('429 без Retry-After -> ждём следующую минуту и повторяем', async () => {
  const sleeps = [];
  const srv = await startServer((_req, res, n) => (n === 1 ? json(res, 429, { title: 'rate' }) : json(res, 200, { data: 'ok' })));
  try {
    const portal = createPortal({ url: srv.url, key: 'k', sleep: async (ms) => sleeps.push(ms), now: () => 90_000 });
    assert.equal(await portal.get('/a'), 'ok');
    assert.equal(srv.requests.length, 2);
    assert.ok(sleeps.includes(31_000)); // 60000 - 30000 + 1000
  } finally {
    srv.close();
  }
});

test('503 -> повтор', async () => {
  const sleeps = [];
  const srv = await startServer((_req, res, n) => (n === 1 ? json(res, 503, {}) : json(res, 200, { data: 1 })));
  try {
    const portal = createPortal({ url: srv.url, key: 'k', sleep: async (ms) => sleeps.push(ms) });
    assert.equal(await portal.get('/a'), 1);
    assert.deepEqual(sleeps.filter((ms) => ms >= 2000), [2000]);
  } finally {
    srv.close();
  }
});

test('нормализация адреса и отказы', () => {
  const make = (url) => createPortal({ url, key: 'k' });
  assert.equal(make('https://gp.su10.ru/api/v1/').baseUrl, 'https://gp.su10.ru');
  assert.equal(make(' https://gp.su10.ru// ').baseUrl, 'https://gp.su10.ru');
  assert.equal(make('http://localhost:3005').baseUrl, 'http://localhost:3005');
  assert.equal(make('http://[::1]:3005/api/v1').baseUrl, 'http://[::1]:3005');
  assert.throws(() => make('http://example.com'), ConfigError);
  assert.throws(() => make('https://tender.su10.ru'), /чужой сервер/);
  assert.throws(() => make('https://api.tender.su10.ru'), /чужой сервер/);
  assert.throws(() => make(''), ConfigError);
  assert.throws(() => createPortal({ url: 'https://gp.su10.ru', key: '' }), ConfigError);
});

test('интервал между стартами запросов при rpm', async () => {
  const clock = 1_000_000; // часы стоят: ожидание считается только от резервирования слотов
  const sleeps = [];
  const fakeFetch = async () => ({ status: 200, text: async () => '{"data":1}' });
  const portal = createPortal({
    url: 'https://gp.su10.ru',
    key: 'k',
    rpm: 60, // 1000 мс между стартами
    fetchImpl: fakeFetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  await Promise.all([portal.get('/a'), portal.get('/b'), portal.get('/c')]);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('maskKey', () => {
  assert.equal(maskKey('thk_abcdefghij'), 'thk_ab***');
});
