/**
 * Проход одной модели по находкам: пачки позиций, кэш по позиции, повторы, деление пачки,
 * дозапрос пропущенных, второй проход с рассуждениями (--think).
 *
 * Системный промпт постоянен в пределах прогона, данные идут отдельным user-сообщением:
 * сервер модели переиспользует кэш префикса.
 */

import { ConfigError } from './env.mjs';
import { LlmError } from './llm.mjs';
import { estimateTokens, packBatches, prepareBatch } from './payload.mjs';
import { cacheKey, readCache, writeCache } from './cache.mjs';
import { clipText } from './format.mjs';
import { InvalidResponseError, LABEL_UNSURE, validateAnswer } from './validate.mjs';

const PER_FINDING_TOKENS = 200;
const BASE_ANSWER_TOKENS = 1000;
const THINK_RESERVE = 3000;
const CONTEXT_RESERVE = 1024;
const MIN_BUDGET_TOKENS = 1000;
const DEFAULT_BATCH_FINDINGS = 60;
const THINK_TOP_BY_MONEY = 20;
const ROW_LABEL_LENGTH = 60;
const ATTEMPTS = 2;

/** Строгая схема ответа: все поля обязательны, лишних нет. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding: { type: 'string' },
          label: { type: 'string', enum: ['likely_error', 'likely_ok', 'unsure'] },
          reason: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ref: { type: 'string' }, value: { type: 'string' } },
              required: ['ref', 'value'],
              additionalProperties: false,
            },
          },
          basis: { type: 'string' },
        },
        required: ['finding', 'label', 'reason', 'evidence', 'basis'],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
};

/**
 * @typedef {object} Assessment
 * @property {string} findingId
 * @property {string} label
 * @property {string} reason
 * @property {Array<{ ref: string, field: string, entity: string, entityId: string, value: string, label: string }>} evidence
 * @property {string} basis
 * @property {boolean} downgraded
 * @property {'ok' | 'error' | 'missing'} status
 * @property {boolean} think
 */

export const newUsage = () => ({
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  elapsedMs: 0,
  cachedPositions: 0,
  askedPositions: 0,
});

/** Прибавляет part к total (на месте) и возвращает total. */
export const addUsage = (total, part) => {
  for (const key of Object.keys(total)) total[key] += part[key] ?? 0;
  return total;
};

const message = (text) => `Данные позиций и находки:\n\n${text}`;

/** Параметры пакетирования по профилю; мало контекста — ConfigError. */
export const planLimits = (profile, system, think) => {
  const thinkReserve = think ? THINK_RESERVE : 0;
  const budgetTokens = profile.contextTokens - estimateTokens(system) - CONTEXT_RESERVE - thinkReserve;
  if (budgetTokens < MIN_BUDGET_TOKENS) {
    throw new ConfigError(
      `Мало контекста у модели ${profile.name}: на данные остаётся ${budgetTokens} токенов ` +
        `(контекст ${profile.contextTokens}, промпт и навыки ~${estimateTokens(system)}). ` +
        `Увеличьте AI_REVIEW_${profile.name.toUpperCase()}_CONTEXT или сократите навыки.`,
    );
  }
  const byAnswer = Math.floor((profile.maxTokens - BASE_ANSWER_TOKENS - thinkReserve) / PER_FINDING_TOKENS);
  const maxFindings = Math.max(1, Math.min(profile.batchFindings ?? DEFAULT_BATCH_FINDINGS, byAnswer));
  return { budgetTokens, maxFindings, perFindingTokens: PER_FINDING_TOKENS };
};

const maxTokensFor = (profile, findingsCount, think) =>
  Math.min(profile.maxTokens, PER_FINDING_TOKENS * findingsCount + BASE_ANSWER_TOKENS + (think ? THINK_RESERVE : 0));

/** @returns {Assessment} */
const failedAssessment = (findingId, status, reason, think) => ({
  findingId,
  label: LABEL_UNSURE,
  reason,
  evidence: [],
  basis: '',
  downgraded: false,
  status,
  think,
});

/** Ссылка «r3.conversion_coefficient» → устойчивый вид (id сущности, а не псевдоним). */
const stableEvidence = (evidence, prepared, rowNames) => {
  const dot = evidence.ref.indexOf('.');
  const prefix = evidence.ref.slice(0, dot);
  const field = evidence.ref.slice(dot + 1);
  if (prefix.startsWith('r')) {
    const entityId = prepared.rowRefs[prefix];
    return {
      ref: evidence.ref,
      field,
      entity: 'row',
      entityId,
      value: evidence.value,
      label: clipText(rowNames.get(entityId) ?? '', ROW_LABEL_LENGTH),
    };
  }
  if (prefix.startsWith('f')) {
    return { ref: evidence.ref, field, entity: 'finding', entityId: prepared.findingRefs[prefix], value: evidence.value, label: 'находка' };
  }
  return { ref: evidence.ref, field, entity: 'position', entityId: prepared.positionRefs[prefix], value: evidence.value, label: 'позиция' };
};

const toAssessment = (validated, prepared, rowNames, think) => ({
  findingId: validated.findingId,
  label: validated.label,
  reason: validated.reason,
  evidence: validated.evidence.map((e) => stableEvidence(e, prepared, rowNames)),
  basis: validated.basis ?? '',
  downgraded: validated.downgraded,
  status: 'ok',
  think,
});

/** Подпись «~9 тыс.» для прогресса. */
const thousands = (tokens) => `~${Math.max(1, Math.round(tokens / 1000))} тыс.`;

/**
 * Один проход модели.
 * @param {object} opts
 * @param {{ chat: Function }} opts.client
 * @param {import('./env.mjs').IModelProfile} opts.profile
 * @param {string} opts.system
 * @param {string} opts.promptVersion
 * @param {string} opts.skillsRev
 * @param {Set<string>} [opts.knownBasis]
 * @param {Array<{ position: object, findings: object[] }>} opts.items
 * @param {boolean} [opts.think]
 * @param {{ read: boolean, write: boolean, dir: string }} [opts.cache]
 * @param {(line: string) => void} [opts.onProgress]
 * @returns {Promise<{ results: Map<string, Assessment>, usage: ReturnType<typeof newUsage> }>}
 */
export const reviewPass = async ({
  client,
  profile,
  system,
  promptVersion,
  skillsRev,
  knownBasis,
  items,
  think = false,
  cache = { read: false, write: false, dir: '' },
  onProgress = () => {},
}) => {
  /** @type {Map<string, Assessment>} */
  const results = new Map();
  const usage = newUsage();
  const keys = new Map(); // position.id → ключ кэша
  const misses = [];

  for (const item of items) {
    const key = cacheKey({
      promptVersion,
      skillsRev,
      model: profile.model,
      think,
      text: prepareBatch([item]).text,
      fingerprints: item.findings.map((f) => f.fingerprint || f.id),
    });
    keys.set(item.position.id, key);
    const stored = cache.read ? readCache(cache.dir, profile.name, key) : undefined;
    const byId = new Map((stored ?? []).map((a) => [a.findingId, a]));
    const complete = stored && item.findings.every((f) => byId.get(f.id)?.status === 'ok');
    if (complete) {
      for (const f of item.findings) results.set(f.id, { ...byId.get(f.id), think });
      usage.cachedPositions += 1;
    } else {
      misses.push(item);
    }
  }
  usage.askedPositions = misses.length;
  if (items.length > 0) {
    onProgress(`${profile.name}: из кэша ${usage.cachedPositions} из ${items.length} позиций, к модели ${misses.length}`);
  }

  const limits = misses.length > 0 ? planLimits(profile, system, think) : undefined;
  const batches = limits ? packBatches(misses, limits) : [];

  const chat = async (prepared, findingsCount) => {
    const res = await client.chat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message(prepared.text) },
      ],
      schema: RESPONSE_SCHEMA,
      schemaName: 'finding_review',
      maxTokens: maxTokensFor(profile, findingsCount, think),
      think,
    });
    usage.requests += 1;
    usage.promptTokens += res.usage?.promptTokens ?? 0;
    usage.completionTokens += res.usage?.completionTokens ?? 0;
    usage.reasoningTokens += res.usage?.reasoningTokens ?? 0;
    usage.elapsedMs += res.elapsedMs ?? 0;
    return res;
  };

  /** Запрос с одним повтором; null — ответ так и не разобрался. */
  const tryAsk = async (batch) => {
    const prepared = prepareBatch(batch);
    const count = batch.reduce((sum, it) => sum + it.findings.length, 0);
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const res = await chat(prepared, count);
      if (!res.json) continue;
      try {
        return { prepared, ...validateAnswer(res.json, prepared, { knownBasis }) };
      } catch (err) {
        if (!(err instanceof InvalidResponseError)) throw err;
      }
    }
    return null;
  };

  const rowNamesOf = (batch) => {
    const names = new Map();
    for (const it of batch) for (const row of it.position.rows ?? []) names.set(row.id, row.name ?? '');
    return names;
  };

  const askBatch = async (batch) => {
    const outcome = await tryAsk(batch);
    if (outcome === null) {
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await askBatch(batch.slice(0, mid));
        await askBatch(batch.slice(mid));
        return;
      }
      for (const f of batch[0].findings) {
        results.set(f.id, failedAssessment(f.id, 'error', 'ответ модели не разобран', think));
      }
      return;
    }

    const names = rowNamesOf(batch);
    for (const a of outcome.assessments) results.set(a.findingId, toAssessment(a, outcome.prepared, names, think));
    if (outcome.missing.length === 0) return;

    // Один дозапрос только по пропущенным.
    const lost = new Set(outcome.missing);
    const subItems = batch
      .map((it) => ({ position: it.position, findings: it.findings.filter((f) => lost.has(f.id)) }))
      .filter((it) => it.findings.length > 0);
    const subPrepared = prepareBatch(subItems);
    let again = null;
    const res = await chat(subPrepared, lost.size);
    if (res.json) {
      try {
        again = validateAnswer(res.json, subPrepared, { knownBasis });
      } catch (err) {
        if (!(err instanceof InvalidResponseError)) throw err;
      }
    }
    for (const a of again?.assessments ?? []) results.set(a.findingId, toAssessment(a, subPrepared, names, think));
    for (const id of lost) {
      if (!results.has(id)) results.set(id, failedAssessment(id, 'missing', 'модель пропустила находку', think));
    }
  };

  const flush = (batch) => {
    if (!cache.write) return;
    for (const item of batch) {
      const found = item.findings.map((f) => results.get(f.id));
      if (found.every((a) => a?.status === 'ok')) writeCache(cache.dir, profile.name, keys.get(item.position.id), found);
    }
  };

  let abortReason = null;
  for (let i = 0; i < batches.length && abortReason === null; i += 1) {
    const batch = batches[i];
    const startedAt = Date.now();
    try {
      await askBatch(batch);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      abortReason = err.message;
    }
    flush(batch);
    const findingsCount = batch.reduce((sum, it) => sum + it.findings.length, 0);
    const tokens = prepareBatch(batch).estimatedTokens;
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    onProgress(
      `${profile.name}: пачка ${i + 1}/${batches.length} · ${findingsCount} находок · ${thousands(tokens)} токенов · ${seconds} с` +
        (abortReason ? ` · остановлено: ${abortReason}` : ''),
    );
  }

  for (const item of misses) {
    for (const f of item.findings) {
      if (!results.has(f.id)) {
        results.set(f.id, failedAssessment(f.id, 'error', abortReason ? `ошибка модели: ${abortReason}` : 'нет ответа', think));
      }
    }
  }
  return { results, usage };
};

/** Находки для второго прохода: неуверенные + самые дорогие по |Δ| (кроме сбойных). */
export const selectThinkTargets = (items, firstResults) => {
  const usable = [];
  for (const item of items) {
    for (const f of item.findings) {
      const a = firstResults.get(f.id);
      if (a && a.status !== 'error') usable.push({ f, a });
    }
  }
  const ids = new Set(usable.filter(({ a }) => a.label === LABEL_UNSURE).map(({ f }) => f.id));
  usable
    .slice()
    .sort((x, y) => Math.abs(Number(y.f.moneyDelta ?? 0)) - Math.abs(Number(x.f.moneyDelta ?? 0)))
    .slice(0, THINK_TOP_BY_MONEY)
    .filter(({ f }) => Number(f.moneyDelta ?? 0) !== 0)
    .forEach(({ f }) => ids.add(f.id));
  return items
    .map((item) => ({ position: item.position, findings: item.findings.filter((f) => ids.has(f.id)) }))
    .filter((item) => item.findings.length > 0);
};

/**
 * Проход модели целиком: первый проход и, при think, второй с рассуждениями.
 * Уверенная оценка второго прохода заменяет первую (think: true).
 * @param {Parameters<typeof reviewPass>[0] & { think?: boolean }} opts
 */
export const reviewItems = async (opts) => {
  const { think = false, profile, onProgress = () => {} } = opts;
  const first = await reviewPass({ ...opts, think: false });
  if (!think) return first;
  if (!profile.thinkExtra) {
    onProgress(`${profile.name}: --think пропущен, не задан AI_REVIEW_${profile.name.toUpperCase()}_THINK_EXTRA`);
    return first;
  }

  const targets = selectThinkTargets(opts.items, first.results);
  if (targets.length === 0) return first;
  onProgress(`${profile.name}: второй проход с рассуждениями, находок ${targets.reduce((n, it) => n + it.findings.length, 0)}`);
  const second = await reviewPass({ ...opts, items: targets, think: true });
  for (const [id, a] of second.results) {
    if (a.status === 'ok' && a.label !== LABEL_UNSURE) first.results.set(id, { ...a, think: true });
  }
  return { results: first.results, usage: addUsage(first.usage, second.usage) };
};
