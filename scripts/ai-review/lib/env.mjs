/**
 * Чтение настроек из scripts/ai-review/ai-review.env.
 *
 * Читается ТОЛЬКО этот файл. process.env не используется: переменные окружения
 * (например, чужие TENDERHUB_* от других скриптов) не должны подменять настройки.
 *
 * Формат: KEY=VALUE построчно. Пустые строки и строки с «#» в начале пропускаются.
 * Допустимы BOM UTF-8 и CRLF (файл правят в Блокноте), кавычки вокруг значения,
 * префикс «export ». Инлайн-комментарии НЕ поддерживаются (в URL бывает «#»).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Ошибка конфигурации: CLI печатает текст без стека и выходит с кодом 2. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_ENV_PATH = fileURLToPath(new URL('../ai-review.env', import.meta.url));

const DEFAULT_CONTEXT_TOKENS = 16384;
const DEFAULT_TIMEOUT_SEC = 900;
const DEFAULT_MAX_TOKENS = 8192;
const MODEL_NAME_RE = /^[a-z0-9_]+$/;

/**
 * Разбор текста env-файла в Map.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export const parseEnvText = (text) => {
  const values = new Map();
  const clean = text.replace(/^﻿/, '');
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.replace(/^export\s+/, '');
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      if ((first === '"' || first === "'") && value.endsWith(first)) {
        value = value.slice(1, -1);
      }
    }
    values.set(key, value);
  }
  return values;
};

/**
 * Положительное целое из env-значения или значение по умолчанию.
 * @param {Map<string, string>} values
 * @param {string} key
 * @param {number} fallback
 */
const readPositiveInt = (values, key, fallback) => {
  const raw = values.get(key);
  if (raw === undefined || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ConfigError(`${key}: ожидается положительное целое число, указано «${raw}»`);
  }
  return num;
};

/**
 * Необязательный JSON-объект из env-значения.
 * @param {Map<string, string>} values
 * @param {string} key
 * @returns {Record<string, unknown> | undefined}
 */
const readJsonObject = (values, key) => {
  const raw = values.get(key);
  if (raw === undefined || raw === '') return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${key}: неверный JSON (${err.message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${key}: ожидается JSON-объект, например {"a":1}`);
  }
  return parsed;
};

/**
 * @typedef {object} IModelProfile
 * @property {string} name
 * @property {string} baseUrl
 * @property {string} apiKey         пустая строка, если ключ не нужен (локальная Ollama)
 * @property {string} model
 * @property {number} contextTokens
 * @property {number} timeoutMs
 * @property {number} maxTokens
 * @property {Record<string, unknown> | undefined} extra
 */

/**
 * @typedef {object} IConfig
 * @property {string} file
 * @property {{ url: string, key: string }} portal
 * @property {string[]} modelNames
 * @property {Record<string, IModelProfile>} profiles  только полные профили (есть BASE_URL и MODEL)
 */

/**
 * @param {Map<string, string>} values
 * @param {string} name  имя профиля в нижнем регистре
 * @returns {IModelProfile | undefined}  undefined — профиль не описан полностью
 */
const buildProfile = (values, name) => {
  const upper = name.toUpperCase();
  const key = (suffix) => `AI_REVIEW_${upper}_${suffix}`;
  const baseUrl = values.get(key('BASE_URL')) ?? '';
  const model = values.get(key('MODEL')) ?? '';
  if (!baseUrl || !model) return undefined;
  let protocol = '';
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    // ниже — общая ошибка
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new ConfigError(`${key('BASE_URL')}: неверный адрес «${baseUrl}», ожидается вид http://<ПК>:11434/v1`);
  }
  return {
    name,
    baseUrl,
    apiKey: values.get(key('API_KEY')) ?? '',
    model,
    contextTokens: readPositiveInt(values, key('CONTEXT'), DEFAULT_CONTEXT_TOKENS),
    timeoutMs: readPositiveInt(values, key('TIMEOUT_SEC'), DEFAULT_TIMEOUT_SEC) * 1000,
    maxTokens: readPositiveInt(values, key('MAX_TOKENS'), DEFAULT_MAX_TOKENS),
    extra: readJsonObject(values, key('EXTRA')),
  };
};

/**
 * @param {string} [filePath]
 * @returns {IConfig}
 */
export const loadConfig = (filePath = DEFAULT_ENV_PATH) => {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ConfigError(
        'Нет scripts/ai-review/ai-review.env — скопируйте ai-review.env.example рядом и заполните',
      );
    }
    throw new ConfigError(`Не удалось прочитать ${filePath}: ${err.message}`);
  }
  const values = parseEnvText(text);

  const modelNames = (values.get('AI_REVIEW_MODELS') ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  for (const name of modelNames) {
    if (!MODEL_NAME_RE.test(name)) {
      throw new ConfigError(`AI_REVIEW_MODELS: имя профиля «${name}» недопустимо, разрешены a-z, 0-9 и _`);
    }
  }

  /** @type {Record<string, IModelProfile>} */
  const profiles = {};
  // Описанные в файле профили доступны и по --models, даже если их нет в AI_REVIEW_MODELS.
  const declared = [...values.keys()]
    .map((key) => /^AI_REVIEW_([A-Z0-9_]+)_BASE_URL$/.exec(key)?.[1]?.toLowerCase())
    .filter(Boolean);
  for (const name of new Set([...modelNames, ...declared])) {
    const profile = buildProfile(values, name);
    if (profile) profiles[name] = profile;
  }

  return {
    file: filePath,
    portal: {
      url: values.get('TENDERHUB_API_URL') ?? '',
      key: values.get('TENDERHUB_API_KEY') ?? '',
    },
    modelNames,
    profiles,
  };
};

/**
 * @param {IConfig} config
 * @param {string} name
 * @returns {IModelProfile}
 */
export const getProfile = (config, name) => {
  const lower = String(name).trim().toLowerCase();
  const profile = config.profiles[lower];
  if (!profile) {
    const upper = lower.toUpperCase();
    throw new ConfigError(
      `профиль ${lower} не описан в ai-review.env: нужны AI_REVIEW_${upper}_BASE_URL и AI_REVIEW_${upper}_MODEL`,
    );
  }
  return profile;
};
