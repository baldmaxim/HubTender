#!/usr/bin/env node
// Fake LLM-прокси для readiness-прогонов в режиме AI_PROVIDER_MODE=proxy_llm.
//
// Отдельный файл, а не флаг существующего fake-openrouter-server.mjs: тот
// обслуживает прямой OpenRouter-путь и должен остаться неизменным.
//
// Смысл фейка — ДОКАЗАТЬ инварианты, а не изобразить работающий прокси:
//   * GET /key и GET /models/user отвечают 404 — если HUBTender их дёрнет,
//     это видно в /__stats, а не маскируется удачным ответом;
//   * chat без X-Idempotency-Key отвергается 400 — единственный честный способ
//     проверить §5.1 по ФАКТУ, а не чтением кода;
//   * присланный model игнорируется, в ответе всегда другая модель — прогоняет
//     ветку дрейфа модели (вариант A);
//   * stream / provider / models в теле → 400: мы обязаны их не слать.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_PROXY_PORT || 8392);
const TOKEN_RE = /^[0-9a-fA-F]{64}$/;

const stats = {
  chat: 0,
  health: 0,
  key: 0,            // обязан остаться 0
  models: 0,         // обязан остаться 0
  missing_idempotency_key: 0, // обязан остаться 0
  unique_idempotency_keys: 0,
  stripped_field_sent: 0,     // обязан остаться 0
};
const seenKeys = new Set();

const send = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve(null); } });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/__stats') {
    stats.unique_idempotency_keys = seenKeys.size;
    return send(res, 200, stats);
  }

  // Публичный liveness — без токена, вне location /api/ (как у настоящего).
  if (url.pathname === '/healthz') {
    stats.health += 1;
    return send(res, 200, { status: 'ok' });
  }

  // Эндпоинтов OpenRouter у прокси нет. Считаем обращения и отвечаем 404.
  if (url.pathname.includes('/key') || url.pathname.includes('/models')) {
    if (url.pathname.includes('/key')) stats.key += 1;
    else stats.models += 1;
    return send(res, 404, { error: { code: 'not_found', message: 'endpoint not supported by proxy' } });
  }

  if (url.pathname !== '/api/v1/chat/completions') {
    return send(res, 404, { error: { code: 'not_found', message: 'unknown endpoint' } });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!TOKEN_RE.test(token)) {
    return send(res, 401, { error: { code: 'unauthorized', message: 'bad token' } });
  }

  const idem = req.headers['x-idempotency-key'];
  if (!idem) {
    stats.missing_idempotency_key += 1;
    return send(res, 400, { error: { code: 'invalid_request', message: 'X-Idempotency-Key required' } });
  }
  seenKeys.add(idem);

  const body = await readBody(req);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return send(res, 400, { error: { code: 'invalid_request', message: 'messages required' } });
  }
  if (body.stream === true) {
    return send(res, 400, { error: { code: 'streaming_not_supported', message: 'streaming is disabled' } });
  }
  // Эти поля прокси вырезает — присылать их незачем. Ловим факт отправки.
  for (const f of ['provider', 'models', 'route', 'transforms', 'plugins', 'stream_options', 'debug']) {
    if (f in body) {
      stats.stripped_field_sent += 1;
      return send(res, 400, { error: { code: 'invalid_request', message: `field ${f} must not be sent` } });
    }
  }

  // Инъекция отказов для проверки ретраев и классификации ошибок.
  switch (url.searchParams.get('__force') || req.headers['x-force-failure']) {
    case 'queue_full':
      res.setHeader('retry-after', '1');
      return send(res, 503, { error: { code: 'queue_full', message: 'proxy queue is full' } });
    case 'deadline_exceeded':
      return send(res, 504, { error: { code: 'deadline_exceeded', message: 'server deadline exceeded' } });
    case 'payload_too_large':
      return send(res, 413, { error: { code: 'payload_too_large', message: 'body too large' } });
    case 'openrouter_raw':
      // Ошибка OpenRouter пробрасывается КАК ЕСТЬ, без конверта прокси.
      return send(res, 400, { message: 'no/such-model is not a valid model ID', code: 400 });
    default:
      break;
  }

  stats.chat += 1;
  res.setHeader('x-proxy-request-id', `px-${stats.chat}`);
  res.setHeader('x-openrouter-request-id', `gen-e2e-${stats.chat}`);

  // Вариант A: присланный model игнорируется. Отвечаем ДРУГОЙ моделью —
  // так readiness прогоняет ветку фиксации дрейфа.
  return send(res, 200, {
    id: `gen-${stats.chat}`,
    model: 'fakeai/router-picked-v2',
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ results: [] }) },
    }],
    usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 },
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fake-proxy-llm listening on http://127.0.0.1:${PORT}\n`);
});
