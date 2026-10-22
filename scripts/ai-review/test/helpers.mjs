// Общие заготовки тестов ai-review: фейковые серверы и пример состояния прогона.
// Не тест (имя без .test.mjs), в glob node --test не попадает.

import http from 'node:http';

/** Фейковый HTTP-сервер: handler(req, res, body, n). Возвращает { url, calls, close }. */
export const startServer = async (handler) => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body, calls.length);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
};

export const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Профиль модели для тестов. */
export const makeProfile = (url, patch = {}) => ({
  name: 'qwen',
  baseUrl: `${url}/v1`,
  apiKey: '',
  model: 'qwen-test',
  contextTokens: 16384,
  timeoutMs: 5000,
  maxTokens: 8192,
  extra: undefined,
  thinkExtra: undefined,
  batchFindings: 60,
  ...patch,
});

const ev = (entity, entityId, field, value, label) => ({ ref: `x.${field}`, field, entity, entityId, value, label });

/** Состояние прогона на 4 находки, две модели. */
export const makeState = () => ({
  version: 1,
  createdAt: new Date(2026, 9, 23, 14, 5).toISOString(),
  tender: { id: 't-1', number: '256', version: 3, title: 'Название' },
  models: [
    { name: 'qwen', model: 'qwen3.8-27b-pricer-rl648' },
    { name: 'minimax', model: 'minimax/m3' },
  ],
  promptVersion: 'review-v1@1a2b3c4d',
  skillsRev: 'a1b2c3d',
  usage: {},
  items: [
    {
      key: 'f1', findingId: 'fid-1', ruleCode: 'P', entityType: 'boq_item', entityId: 'row-1', itemId: 'row-1', positionId: 'pos-1',
      positionNumber: 12, fingerprint: 'fp-1', moneyDelta: 1_200_000, detail: 'Цена 125 при медиане 4800',
      where: 'поз. 12.3 «Утеплитель ПСБ-С 25»', link: 'https://gp.su10.ru/positions/pos-1/items?tenderId=t-1&positionId=pos-1&itemId=row-1',
      ai: {
        qwen: { label: 'likely_error', reason: '125 ₽/м³ при медиане 4 800', evidence: [ev('row', 'row-1', 'unit_rate', '125', 'ПСБ-С 25'), ev('position', 'pos-1', 'unit', 'м3', 'позиция')], basis: 'P-1', downgraded: false, status: 'ok', think: false },
        minimax: { label: 'likely_error', reason: 'цена за м² вместо м³', evidence: [], basis: '', downgraded: false, status: 'ok', think: false },
      },
      combined: { label: 'likely_error', reason: '125 ₽/м³ при медиане 4 800', basis: 'P-1', agree: true },
    },
    {
      key: 'f2', findingId: 'fid-2', ruleCode: 'GA', entityType: 'boq_item', entityId: 'row-2', itemId: 'row-2', positionId: 'pos-2',
      positionNumber: 13, fingerprint: 'fp-2', moneyDelta: 48_000, detail: 'Материал заведён 2 раза',
      where: 'поз. 13 «Кладка»', link: 'https://gp.su10.ru/positions/pos-2/items?tenderId=t-1&positionId=pos-2&itemId=row-2',
      ai: {
        qwen: { label: 'likely_ok', reason: 'два слоя утеплителя', evidence: [], basis: '', downgraded: false, status: 'ok', think: false },
        minimax: { label: 'likely_ok', reason: 'разные слои', evidence: [], basis: '', downgraded: false, status: 'ok', think: false },
      },
      combined: { label: 'likely_ok', reason: 'два слоя утеплителя', basis: '', agree: true },
    },
    {
      key: 'f3', findingId: 'fid-3', ruleCode: 'Q', entityType: 'client_position', entityId: 'pos-3', itemId: null, positionId: 'pos-3',
      positionNumber: 14, fingerprint: 'fp-3', moneyDelta: 950, detail: 'Нулевая цена',
      where: 'поз. 14 «Окраска»', link: 'https://gp.su10.ru/positions/pos-3/items?tenderId=t-1&positionId=pos-3',
      ai: {
        qwen: { label: 'likely_error', reason: 'цены нет', evidence: [], basis: '', downgraded: false, status: 'ok', think: false },
        minimax: { label: 'likely_ok', reason: 'бесплатная работа', evidence: [], basis: '', downgraded: false, status: 'ok', think: false },
      },
      combined: { label: 'unsure', reason: 'модели расходятся: qwen — ошибка: цены нет; minimax — норма: бесплатная работа', basis: '', agree: false },
    },
    {
      key: 'f4', findingId: 'fid-4', ruleCode: 'T', entityType: 'tender', entityId: 't-1', itemId: null, positionId: null,
      positionNumber: null, fingerprint: 'fp-4', moneyDelta: null, detail: 'Нет версии прайса',
      where: 'тендер', link: null, ai: {}, combined: null,
    },
  ],
});
