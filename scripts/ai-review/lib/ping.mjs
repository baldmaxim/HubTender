/**
 * Команда ping: проверка связи с порталом и с каждой моделью.
 * Ничего не пишет в портал; ключи в вывод не попадают (только maskKey).
 */

import { randomInt } from 'node:crypto';
import { ConfigError, getProfile } from './env.mjs';
import { createLlmClient, LlmError } from './llm.mjs';
import { createPortal, maskKey, PortalError } from './portal.mjs';
import { estimateTokens } from './payload.mjs';

// 75 %: оценка токенов грубая, а ответу (с рассуждениями) нужно место — иначе
// промпт с ответом не влезет в контекст и Ollama обрежет начало при верной настройке.
const CONTEXT_FILL_RATIO = 0.75;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const MIN_ANSWER_TOKENS = 512;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'integer' } },
  required: ['answer'],
  additionalProperties: false,
};
const CODE_SCHEMA = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
  additionalProperties: false,
};

const FILLER_WORKS = [
  'Устройство цементно-песчаной стяжки толщиной 50 мм',
  'Монтаж металлического каркаса перегородок',
  'Кладка наружных стен из газобетонных блоков',
  'Окраска стен водоэмульсионными составами',
  'Устройство гидроизоляции кровли в два слоя',
  'Прокладка кабеля ВВГнг в гофротрубе',
  'Монтаж трубопроводов отопления из стальных труб',
  'Устройство фасадной системы с минераловатным утеплителем',
];
const FILLER_UNITS = ['м2', 'м3', 'м.п.', 'шт', 'т'];

/** Случайный контрольный код из 6 символов A–Z, 2–9. */
export const makeControlCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/**
 * Промпт на ≈ contextTokens × 75 % (по estimateTokens): код в начале, заполнитель, вопрос в конце.
 * @param {number} contextTokens
 * @param {string} code
 * @returns {{ system: string, user: string }}
 */
export const buildContextPrompt = (contextTokens, code) => {
  const targetTokens = Math.floor(contextTokens * CONTEXT_FILL_RATIO);
  const head = `Контрольный код: ${code}\nНиже идёт текст-заполнитель, его читать не нужно.\n\n`;
  const tail = '\nКакой контрольный код указан в самом начале? Ответь JSON вида {"code": "..."}.';
  const lines = [];
  let size = estimateTokens(head) + estimateTokens(tail);
  for (let i = 1; size < targetTokens; i += 1) {
    const line =
      `${i}. ${FILLER_WORKS[i % FILLER_WORKS.length]}, ` +
      `${FILLER_UNITS[i % FILLER_UNITS.length]}, объём ${(i * 7) % 900 + 10}, ` +
      `расценка ${(i * 13) % 5000 + 100} руб.`;
    lines.push(line);
    size += estimateTokens(line) + 1;
  }
  return {
    system: 'Ты внимательный ассистент. Отвечай строго JSON по схеме.',
    user: `${head}${lines.join('\n')}\n${tail}`,
  };
};

const seconds = (ms) => `${(ms / 1000).toFixed(1)} с`;

const describeError = (err) => {
  if (err instanceof LlmError || err instanceof PortalError) return err.message;
  return err?.message ?? String(err);
};

/** @param {Array<{ name: string, ok: boolean, note?: string }>} results */
const record = (results, name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'ОК    ' : 'ОШИБКА'} ${name}${note ? ` — ${note}` : ''}`);
};

const checkPortal = async (config, results) => {
  console.log('Портал');
  let portal;
  try {
    portal = createPortal(config.portal);
  } catch (err) {
    if (err instanceof ConfigError) {
      record(results, 'портал: настройки', false, err.message);
      return;
    }
    throw err;
  }
  console.log(`  адрес: ${portal.baseUrl}, ключ: ${maskKey(config.portal.key)}`);

  try {
    const rules = await portal.get('/api/v1/quality/rules');
    record(results, 'портал: правила (verification:read)', true, `правил: ${Array.isArray(rules) ? rules.length : '?'}`);
  } catch (err) {
    record(results, 'портал: правила (verification:read)', false, describeError(err));
  }
  try {
    const tenders = await portal.get('/api/v1/tenders/brief', { search: '', is_archived: 'false' });
    record(results, 'портал: тендеры (tenders:read)', true, `тендеров: ${Array.isArray(tenders) ? tenders.length : '?'}`);
  } catch (err) {
    record(results, 'портал: тендеры (tenders:read)', false, describeError(err));
  }
  console.log('  право verification:write без записи не проверить — проверится при apply');
};

const checkModel = async (profile, quick, results) => {
  const label = `модель ${profile.name}`;
  console.log(`\nМодель ${profile.name}: ${profile.model} (${profile.baseUrl})`);
  const client = createLlmClient(profile);

  // (а) список моделей
  try {
    const ids = await client.listModels();
    if (ids.includes(profile.model)) record(results, `${label}: список моделей`, true, 'модель найдена');
    else console.log(`  ВНИМАНИЕ: модели ${profile.model} нет в /models (доступно: ${ids.length}) — не провал`);
  } catch (err) {
    console.log(`  ВНИМАНИЕ: список моделей недоступен (${describeError(err)}) — не провал`);
  }

  // (б) JSON по схеме
  try {
    const res = await client.chat({
      messages: [{ role: 'user', content: 'Сколько будет 17 + 25?' }],
      schema: ANSWER_SCHEMA,
      schemaName: 'answer',
    });
    const ok = res.json?.answer === 42;
    const reasoning = res.reasoning ? `рассуждения были (${res.reasoning.length} симв.)` : 'без рассуждений';
    const tokens = `токены: запрос ${res.usage.promptTokens ?? '?'}, ответ ${res.usage.completionTokens ?? '?'}` +
      (res.usage.reasoningTokens ? `, из них рассуждения ${res.usage.reasoningTokens}` : '');
    const note = ok
      ? `формат ${res.format}, ${seconds(res.elapsedMs)}, ${reasoning}, ${tokens}`
      : `ответ не 42: ${res.parseError ?? JSON.stringify(res.json)}; формат ${res.format}`;
    record(results, `${label}: JSON по схеме`, ok, note);
  } catch (err) {
    record(results, `${label}: JSON по схеме`, false, describeError(err));
  }

  if (quick) return;

  // (в) контекст
  console.log(`  проверка контекста (${profile.contextTokens} токенов): на медленной карте может занять несколько минут...`);
  const code = makeControlCode();
  const prompt = buildContextPrompt(profile.contextTokens, code);
  const estimatedPrompt = Math.floor(profile.contextTokens * CONTEXT_FILL_RATIO);
  const maxTokens = Math.max(MIN_ANSWER_TOKENS, Math.min(profile.maxTokens, profile.contextTokens - estimatedPrompt));
  try {
    const res = await client.chat({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      schema: CODE_SCHEMA,
      schemaName: 'code',
      maxTokens,
    });
    const found = String(res.json?.code ?? '').trim().toUpperCase();
    if (found === code) {
      record(results, `${label}: контекст`, true, `запрос ${res.usage.promptTokens ?? '?'} токенов, ${seconds(res.elapsedMs)}`);
    } else if (res.parseError) {
      // Без JSON нельзя судить о контексте: чаще всего ответ съели рассуждения.
      const thinking = res.finishReason === 'length'
        ? ` — ответ не уложился в ${maxTokens} токенов; если модель рассуждает, отключите это через AI_REVIEW_${profile.name.toUpperCase()}_EXTRA`
        : '';
      record(results, `${label}: контекст`, false, `нет JSON в ответе: ${res.parseError}${thinking}`);
    } else {
      record(
        results,
        `${label}: контекст`,
        false,
        `код не совпал (ответ ${JSON.stringify(found)}). Модель видит меньше контекста, чем AI_REVIEW_${profile.name.toUpperCase()}_CONTEXT: ` +
          'Ollama молча обрезает начало — поднимите OLLAMA_CONTEXT_LENGTH / num_ctx; ' +
          'LM Studio — Context Length при загрузке модели; vLLM — --max-model-len',
      );
    }
  } catch (err) {
    record(results, `${label}: контекст`, false, describeError(err));
  }
};

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ models?: string[], quick?: boolean, noPortal?: boolean }} options
 * @returns {Promise<number>}  код выхода
 */
export const runPing = async (config, { models, quick = false, noPortal = false }) => {
  const names = models && models.length > 0 ? models : config.modelNames;
  if (names.length === 0 && noPortal) {
    throw new ConfigError('Нет моделей для проверки: задайте AI_REVIEW_MODELS или --models');
  }
  const profiles = names.map((name) => getProfile(config, name));

  /** @type {Array<{ name: string, ok: boolean, note?: string }>} */
  const results = [];
  if (!noPortal) await checkPortal(config, results);
  for (const profile of profiles) await checkModel(profile, quick, results);

  console.log('\nСводка');
  for (const { name, ok } of results) console.log(`  ${ok ? 'ОК    ' : 'ОШИБКА'} ${name}`);
  const failed = results.filter((item) => !item.ok).length;
  console.log(failed === 0 ? '\nВсё в порядке.' : `\nПровалено пунктов: ${failed}.`);
  return failed === 0 ? 0 : 1;
};
