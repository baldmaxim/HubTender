/**
 * Клиент API портала TenderHUB по ключу (заголовок X-API-Key) на глобальном fetch.
 *
 * Ключ нигде не печатается целиком: ни в ошибках, ни в логах — только maskKey().
 */

import { ConfigError } from './env.mjs';

const OBSOLETE_HOST = 'tender.su10.ru';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const RETRY_429_MAX = 3;
const RETRY_NETWORK_DELAYS_MS = [2000, 5000, 15000];

export class PortalError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, path?: string }} [info]
   */
  constructor(message, { status, code, path } = {}) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

/** Первые 6 символов ключа + «***». */
export const maskKey = (key) => `${String(key ?? '').slice(0, 6)}***`;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Проверка и нормализация адреса портала: без хвостовых «/» и «/api/v1».
 * @param {string} rawUrl
 * @returns {string}
 */
export const normalizePortalUrl = (rawUrl) => {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    throw new ConfigError('Не задан TENDERHUB_API_URL в ai-review.env (портал: https://gp.su10.ru)');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigError('TENDERHUB_API_URL: неверный адрес, ожидается вид https://gp.su10.ru');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === OBSOLETE_HOST || host.endsWith(`.${OBSOLETE_HOST}`)) {
    throw new ConfigError(
      `TENDERHUB_API_URL: адрес ${OBSOLETE_HOST} устарел и ведёт на чужой сервер; портал — https://gp.su10.ru`,
    );
  }
  if (parsed.protocol === 'http:') {
    if (!LOCAL_HOSTS.has(host)) {
      throw new ConfigError(
        'TENDERHUB_API_URL: http допустим только для localhost (ключ не должен идти открытым текстом); используйте https',
      );
    }
  } else if (parsed.protocol !== 'https:') {
    throw new ConfigError('TENDERHUB_API_URL: поддерживается только https (для локального BFF — http://localhost)');
  }
  const path = parsed.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${parsed.origin}${path}`;
};

/**
 * Подсказка к HTTP-ошибке.
 * @param {number} status
 * @param {string | undefined} code
 * @param {any} body  разобранное тело ошибки
 */
const buildHint = (status, code, body) => {
  if (status === 401) return 'ключ неверный или отозван; ключ шлётся заголовком X-API-Key';
  if (status === 403 && code === 'API_KEY_SCOPE_DENIED') {
    const scope = body?.requiredScope ?? body?.required_scope ?? body?.scope;
    return scope ? `ключу не хватает права ${scope}` : 'ключу не хватает права (см. detail)';
  }
  if (status === 403 && code === 'API_KEY_TENDER_DENIED') {
    return 'тендер не входит в список разрешённых для ключа';
  }
  return '';
};

/**
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.key
 * @param {number} [options.rpm]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.now]
 */
export const createPortal = ({
  url,
  key,
  rpm = 120,
  timeoutMs = 180_000,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  now = Date.now,
}) => {
  const baseUrl = normalizePortalUrl(url);
  if (!key) throw new ConfigError('Не задан TENDERHUB_API_KEY в ai-review.env (Настройки → Доступ к API)');

  const intervalMs = 60_000 / rpm;
  let nextSlotAt = 0;

  // Слот резервируется синхронно до await — параллельные вызовы встают в очередь с шагом intervalMs.
  const waitForSlot = async () => {
    const current = now();
    const start = Math.max(current, nextSlotAt);
    nextSlotAt = start + intervalMs;
    if (start > current) await sleep(start - current);
  };

  const buildUrl = (path, query) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(name, String(value));
    }
    const qs = params.toString();
    return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
  };

  /** Одна попытка. Возвращает { status, text } либо бросает PortalError/сетевую ошибку. */
  const attempt = async (method, path, query, body) => {
    await waitForSlot();
    const headers = {
      'X-API-Key': key,
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(buildUrl(path, query), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  };

  const request = async (method, path, query, body) => {
    let retries429 = 0;
    let retriesNet = 0;
    for (;;) {
      let result;
      try {
        result = await attempt(method, path, query, body);
      } catch (err) {
        if (err instanceof PortalError) throw err;
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new PortalError(`таймаут ${Math.round(timeoutMs / 1000)} с: ${method} ${path}`, { path });
        }
        if (retriesNet < RETRY_NETWORK_DELAYS_MS.length) {
          await sleep(RETRY_NETWORK_DELAYS_MS[retriesNet++]);
          continue;
        }
        const reason = err?.cause?.code ?? err?.message ?? 'неизвестная ошибка';
        throw new PortalError(`не удалось соединиться с ${baseUrl}: ${reason}`, { path });
      }

      const { status, text } = result;
      if (status === 429 && retries429 < RETRY_429_MAX) {
        retries429 += 1;
        // Ответ без Retry-After: лимит окна в минуту — ждём начала следующей минуты.
        await sleep(60_000 - (now() % 60_000) + 1000);
        continue;
      }
      if ([502, 503, 504].includes(status) && retriesNet < RETRY_NETWORK_DELAYS_MS.length) {
        await sleep(RETRY_NETWORK_DELAYS_MS[retriesNet++]);
        continue;
      }
      return interpret(method, path, status, text);
    }
  };

  const interpret = (method, path, status, text) => {
    const ok = status >= 200 && status < 300;
    if (ok && (status === 204 || !text.trim())) return null;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PortalError(
        `${method} ${path}: HTTP ${status}, ответил не портал (HTML): проверьте TENDERHUB_API_URL`,
        { status, path },
      );
    }
    if (ok) {
      return parsed !== null && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
    }

    const code = typeof parsed?.code === 'string' ? parsed.code : undefined;
    const detail = parsed?.detail ?? parsed?.title ?? '';
    const hint = buildHint(status, code, parsed);
    const parts = [`${method} ${path}: HTTP ${status}`];
    if (code) parts[0] += ` [${code}]`;
    if (detail) parts.push(String(detail));
    if (hint) parts.push(hint);
    throw new PortalError(parts.join(' — '), { status, code, path });
  };

  return {
    baseUrl,
    get: (path, query) => request('GET', path, query, undefined),
    post: (path, body) => request('POST', path, undefined, body),
    put: (path, body) => request('PUT', path, undefined, body),
  };
};
