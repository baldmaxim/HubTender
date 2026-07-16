// Этап 2.5 (§24/§28): fake OpenRouter server для browser smoke / integration.
// Реальный OpenRouter в обязательных тестах НЕ используется.
//
//   node scripts/readiness/fake-openrouter-server.mjs <PORT>
//
// Endpoints (официальные формы ответов):
//   GET  /key               — статус ключа с usage/limits;
//   GET  /models/user       — 2 text→text модели + router-модель (должна
//                             отфильтроваться сервером) + истёкшая модель;
//   POST /chat/completions  — scripted structured output: корректные ответы
//                             на 4 synthetic-сценария HUBTender model test;
//   GET  /__stats           — счётчики вызовов (для проверки rollout-off:
//                             chat != admin-test невозможен).
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 8391);
const stats = { key: 0, models: 0, chat: 0 };

const model = (id, over = {}) => ({
  id,
  canonical_slug: id,
  name: `Fake ${id}`,
  description: `Синтетическая модель ${id} для e2e`,
  created: 1700000000,
  expiration_date: null,
  context_length: 128000,
  architecture: {
    modality: 'text->text',
    input_modalities: ['text'],
    output_modalities: ['text'],
    tokenizer: 'Other',
    instruct_type: null,
  },
  pricing: { prompt: '0.000001', completion: '0.000002', request: '0' },
  top_provider: { context_length: 128000, max_completion_tokens: 16000, is_moderated: false },
  per_request_limits: null,
  supported_parameters: ['temperature', 'max_tokens', 'response_format', 'structured_outputs'],
  default_parameters: null,
  supported_voices: null,
  links: { details: 'about:blank' },
  ...over,
});

const CATALOG = [
  model('fakeai/rerank-pro'),
  model('fakeai/rerank-mini', {
    pricing: { prompt: '0.0000002', completion: '0.0000006', request: '0' },
  }),
  // Router-псевдомодель: сервер обязан её отфильтровать (§6).
  model('openrouter/auto', { pricing: { prompt: '-1', completion: '-1', request: '-1' } }),
  // Истёкшая модель: тоже фильтруется.
  model('fakeai/legacy', { expiration_date: '2024-01-01' }),
];

// Корректные ответы на synthetic-сценарии этапа 2.5 (§13).
const ANSWERS = {
  'synthetic|1': 'syn-cable-3x2.5',
  'synthetic|2': 'syn-concrete-m200',
  'synthetic|3': null,
  'synthetic|4': null,
};

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const auth = req.headers.authorization ?? '';
  if (url.pathname === '/__stats') {
    return json(res, 200, stats);
  }
  if (!auth.startsWith('Bearer ')) {
    return json(res, 401, { error: { code: 401, message: 'Missing Authentication header' } });
  }

  if (req.method === 'GET' && url.pathname === '/key') {
    stats.key++;
    return json(res, 200, {
      data: {
        label: 'e2e-fake-key', limit: 25, limit_remaining: 24.5, limit_reset: 'monthly',
        usage: 0.5, usage_daily: 0.1, usage_weekly: 0.3, usage_monthly: 0.5,
        byok_usage: 0, byok_usage_daily: 0, byok_usage_weekly: 0, byok_usage_monthly: 0,
        is_free_tier: false, is_management_key: false, is_provisioning_key: false,
        include_byok_in_limit: true, creator_user_id: null, expires_at: null,
        rate_limit: { requests: -1, interval: '10s', note: 'legacy' },
      },
    });
  }

  if (req.method === 'GET' && url.pathname === '/models/user') {
    stats.models++;
    return json(res, 200, { data: CATALOG, total_count: CATALOG.length, links: { next: null } });
  }

  if (req.method === 'POST' && url.pathname === '/chat/completions') {
    stats.chat++;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let rows = [];
      try {
        const body = JSON.parse(raw);
        const user = (body.messages ?? []).find((m) => m.role === 'user')?.content ?? '';
        const payload = JSON.parse(user.slice(user.indexOf('{')));
        rows = payload.rows ?? [];
      } catch {
        rows = [];
      }
      const results = [];
      for (const row of rows) {
        const ref = row?.row?.row_reference;
        if (!(ref in ANSWERS)) continue;
        const sel = ANSWERS[ref];
        results.push({
          row_reference: ref,
          selected_candidate_id: sel,
          ranked_candidate_ids: sel ? [sel] : [],
          confidence: sel ? 'high' : 'abstain',
          explanation: sel ? 'Возможно соответствует: признаки совпадают.' : 'Возможно соответствия нет.',
          matched_features: [],
          conflicting_features: [],
          abstain_reason: sel ? null : 'кандидаты не соответствуют строке',
        });
      }
      json(res, 200, {
        id: 'gen-e2e', model: 'fakeai/rerank-pro',
        choices: [{
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify({ results }) },
        }],
        usage: { prompt_tokens: 1100, completion_tokens: 260, total_tokens: 1360 },
      });
    });
    return;
  }

  json(res, 404, { error: { code: 404, message: 'not found' } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-openrouter listening on http://127.0.0.1:${PORT}`);
});
