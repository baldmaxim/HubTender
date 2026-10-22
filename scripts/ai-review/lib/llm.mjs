/**
 * Клиент OpenAI-совместимого API чата (Ollama, LM Studio, vLLM, OpenRouter).
 *
 * Запросы идут через node:http/node:https, а не через глобальный fetch: у fetch в Node
 * (undici) headersTimeout 300 с, а медленная локальная модель может отвечать дольше.
 * Таймаут profile.timeoutMs действует на весь запрос целиком.
 */

import http from 'node:http';
import https from 'node:https';

const FALLBACK_STATUSES = new Set([400, 404, 422]);
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_SEC = 120;
const BODY_SNIPPET = 500;
const FORMATS = ['json_schema', 'json_object', 'none'];

export class LlmError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, kind: 'http' | 'network' | 'timeout', body?: string }} info
   */
  constructor(message, { status, kind, body = '' }) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.kind = kind;
    this.body = body.slice(0, BODY_SNIPPET);
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Убирает хвостовые «/»; если пути нет (http://host:11434) — дописывает /v1.
 * @param {string} rawUrl
 */
export const normalizeBaseUrl = (rawUrl) => {
  const parsed = new URL(String(rawUrl).trim());
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path || '/v1'}`;
};

/**
 * Вырезает рассуждения модели из текста.
 * @param {string} text
 * @returns {{ content: string, reasoning: string }}
 */
export const stripThinking = (text) => {
  let rest = String(text ?? '');
  const reasoning = [];

  // Закрывающий тег без открывающего: шаблон (Qwen) ставит <think> в промпт.
  const firstClose = rest.search(/<\/think>/i);
  const firstOpen = rest.search(/<think>/i);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    const closes = [...rest.matchAll(/<\/think>/gi)];
    const end = firstOpen === -1 ? closes[closes.length - 1] : closes[0];
    reasoning.push(rest.slice(0, end.index));
    rest = rest.slice(end.index + end[0].length);
  }

  rest = rest.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    reasoning.push(inner);
    return '';
  });

  // Незакрытый <think> (обрыв по max_tokens): всё после него — рассуждения.
  const open = rest.search(/<think>/i);
  if (open !== -1) {
    reasoning.push(rest.slice(open + '<think>'.length));
    rest = rest.slice(0, open);
  }

  return {
    content: rest.trim(),
    reasoning: reasoning.map((part) => part.trim()).filter(Boolean).join('\n\n'),
  };
};

/**
 * Достаёт JSON-объект из ответа модели.
 * @param {string} text
 * @returns {any | undefined}
 */
export const extractJson = (text) => {
  const source = String(text ?? '').trim();
  const tryParse = (candidate) => {
    try {
      const value = JSON.parse(candidate);
      return value !== null && typeof value === 'object' ? value : undefined;
    } catch {
      return undefined;
    }
  };

  const whole = tryParse(source);
  if (whole !== undefined) return whole;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  if (fenced) {
    const value = tryParse(fenced[1].trim());
    if (value !== undefined) return value;
  }

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start !== -1 && end > start) return tryParse(source.slice(start, end + 1));
  return undefined;
};

/**
 * Один HTTP-запрос с общим таймаутом. Возвращает { status, headers, text }.
 * @param {{ method: string, url: string, headers: Record<string, string>, body?: string, timeoutMs: number }} req
 */
const rawRequest = ({ method, url, headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    let finished = false;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = transport.request(
      target,
      {
        method,
        agent: false, // без keep-alive: каждый запрос — отдельное соединение
        headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          done(resolve, { status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', (err) => done(reject, networkError(err)));
        res.on('aborted', () => done(reject, new LlmError('соединение оборвано сервером', { kind: 'network' })));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(reject, new LlmError(`нет ответа за ${Math.round(timeoutMs / 1000)} с`, { kind: 'timeout' }));
    }, timeoutMs);
    req.on('error', (err) => done(reject, networkError(err)));
    if (body !== undefined) req.write(body);
    req.end();
  });

const networkError = (err) =>
  new LlmError(`сетевая ошибка: ${err?.code ?? err?.message ?? 'неизвестная'}`, { kind: 'network' });

/** Сообщение сервера из тела ошибки (JSON {error:{message}} / {error:"…"}) либо начало текста. */
const describeBody = (text) => {
  try {
    const parsed = JSON.parse(text);
    const err = parsed?.error;
    const message = typeof err === 'string' ? err : err?.message;
    if (message) return String(message).slice(0, 300);
  } catch {
    // не JSON — берём начало текста
  }
  return text.trim().slice(0, 200);
};

/**
 * @param {import('./env.mjs').IModelProfile} profile
 * @param {{ sleep?: (ms: number) => Promise<void>, retryDelaysMs?: number[] }} [options]
 */
export const createLlmClient = (profile, { sleep = defaultSleep, retryDelaysMs = [5000, 15000, 30000, 60000] } = {}) => {
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const isOpenRouter = new URL(baseUrl).hostname.toLowerCase().endsWith('openrouter.ai');
  let formatIndex = 0; // первый формат, на котором сервер ответил 2xx

  const buildHeaders = () => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
    };
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    if (isOpenRouter) headers['X-Title'] = 'TenderHUB ai-review';
    return headers;
  };

  /**
   * Запрос с повторами. 2xx -> { status, headers, text, json }, иначе LlmError.
   * 200 с {error:{code,message}} без choices трактуется как ошибка со status = error.code.
   */
  const send = async (method, path, payload) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    for (let attempt = 0; ; attempt += 1) {
      let failure;
      let retryAfterMs;
      try {
        const res = await rawRequest({
          method,
          url: `${baseUrl}${path}`,
          headers: buildHeaders(),
          body,
          timeoutMs: profile.timeoutMs,
        });
        let json;
        try {
          json = JSON.parse(res.text);
        } catch {
          json = undefined;
        }
        const embedded = res.status >= 200 && res.status < 300 && json?.error && !json?.choices;
        if (res.status >= 200 && res.status < 300 && !embedded) return { ...res, json };

        const status = embedded ? Number(json.error.code) || undefined : res.status;
        const reason = embedded ? String(json.error.message ?? 'ошибка в теле ответа') : describeBody(res.text);
        failure = new LlmError(`HTTP ${status ?? res.status}: ${reason}`, { status, kind: 'http', body: res.text });
        const retryAfter = Number(res.headers['retry-after']);
        if (Number.isFinite(retryAfter) && retryAfter >= 0) {
          retryAfterMs = Math.min(retryAfter, MAX_RETRY_AFTER_SEC) * 1000;
        }
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        if (err.kind === 'timeout') {
          const upper = profile.name.toUpperCase();
          err.message = `${err.message}; увеличьте AI_REVIEW_${upper}_TIMEOUT_SEC в ai-review.env`;
          throw err;
        }
        failure = err;
      }

      const retryable = failure.kind === 'network' || RETRY_STATUSES.has(failure.status);
      if (!retryable || attempt >= retryDelaysMs.length) throw failure;
      await sleep(retryAfterMs ?? retryDelaysMs[attempt]);
    }
  };

  const listModels = async () => {
    const { json } = await send('GET', '/models');
    return (json?.data ?? []).map((item) => item?.id).filter((id) => typeof id === 'string');
  };

  /** Дописывает схему в первое system-сообщение (нет — вставляет первым). */
  const withSchemaPrompt = (messages, schema) => {
    const suffix = `Ответ — только JSON по схеме:\n${JSON.stringify(schema)}`;
    const copy = messages.map((message) => ({ ...message }));
    const idx = copy.findIndex((message) => message.role === 'system');
    if (idx === -1) return [{ role: 'system', content: suffix }, ...copy];
    copy[idx].content = `${copy[idx].content}\n\n${suffix}`;
    return copy;
  };

  const buildBody = ({ messages, schema, schemaName, maxTokens, temperature }, format) => {
    const body = {
      model: profile.model,
      messages: format === 'json_schema' || !schema ? messages : withSchemaPrompt(messages, schema),
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...profile.extra,
    };
    if (schema && format === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    } else if (schema && format === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  };

  const parseResult = (json, schema, elapsedMs, format) => {
    const choice = json?.choices?.[0];
    if (!choice) {
      throw new LlmError('в ответе модели нет choices', { kind: 'http', body: JSON.stringify(json ?? {}) });
    }
    const message = choice.message ?? {};
    const rawContent = typeof message.content === 'string' ? message.content : '';
    const stripped = stripThinking(rawContent);
    const fieldReasoning = [message.reasoning, message.reasoning_content, message.thinking].find(
      (value) => typeof value === 'string' && value.trim(),
    );
    const reasoning = [fieldReasoning?.trim(), stripped.reasoning].filter(Boolean).join('\n\n');
    const content = stripped.content;
    const finishReason = choice.finish_reason ?? undefined;

    let parsedJson;
    let parseError;
    if (schema) {
      parsedJson = extractJson(content);
      if (parsedJson === undefined) {
        if (finishReason === 'length') parseError = 'ответ обрезан по max_tokens';
        else if (!content) parseError = 'пустой ответ модели';
        else parseError = 'в ответе нет корректного JSON';
      }
    }

    const usage = json.usage ?? {};
    return {
      content,
      reasoning,
      json: parsedJson,
      parseError,
      format,
      finishReason,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      },
      elapsedMs,
      model: json.model ?? profile.model,
    };
  };

  /**
   * @param {{ messages: Array<{ role: string, content: string }>, schema?: object, schemaName?: string, maxTokens?: number, temperature?: number }} opts
   */
  const chat = async ({ messages, schema, schemaName = 'answer', maxTokens = profile.maxTokens, temperature = 0 }) => {
    const params = { messages, schema, schemaName, maxTokens, temperature };
    const chain = schema ? FORMATS.slice(formatIndex) : ['none'];
    let lastError;
    for (const format of chain) {
      const startedAt = Date.now();
      try {
        const { json } = await send('POST', '/chat/completions', buildBody(params, format));
        if (schema) formatIndex = FORMATS.indexOf(format);
        return parseResult(json, schema, Date.now() - startedAt, schema ? format : 'none');
      } catch (err) {
        if (err instanceof LlmError && err.kind === 'http' && FALLBACK_STATUSES.has(err.status)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  return { profile, listModels, chat };
};
