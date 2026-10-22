#!/usr/bin/env node
/**
 * ИИ-проверка находок «Проверки данных» скриптом на ПК, который видит офисную модель.
 *
 *   node scripts/ai-review/review.mjs help
 *   node scripts/ai-review/review.mjs ping [--models=qwen,minimax] [--quick] [--no-portal]
 *
 * Настройки — только в scripts/ai-review/ai-review.env (см. README.md).
 */

import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './lib/env.mjs';
import { runPing } from './lib/ping.mjs';

const HELP = `ИИ-проверка находок «Проверки данных»

Использование: node scripts/ai-review/review.mjs <команда> [флаги]

Команды:
  ping   Проверить связь с порталом и моделями
           --models=a,b   профили (по умолчанию — все из AI_REVIEW_MODELS)
           --quick        без проверки контекста (быстро)
           --no-portal    не обращаться к порталу
  help   Эта справка

Настройки читаются только из scripts/ai-review/ai-review.env
(образец — ai-review.env.example).`;

/** Набор флагов каждой команды. */
const COMMANDS = {
  ping: {
    options: {
      models: { type: 'string' },
      quick: { type: 'boolean' },
      'no-portal': { type: 'boolean' },
    },
    run: async ({ values }) => {
      const models = values.models
        ? values.models.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
        : undefined;
      return runPing(loadConfig(), { models, quick: values.quick, noPortal: values['no-portal'] });
    },
  },
  help: {
    options: {},
    run: async () => {
      console.log(HELP);
      return 0;
    },
  },
};

const main = async (argv) => {
  const [command, ...rest] = argv;
  if (!command) {
    console.log(HELP);
    return 0;
  }
  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!spec) {
    console.error(`Неизвестная команда: ${command}\n`);
    console.error(HELP);
    return 2;
  }

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: false, strict: true });
  } catch (err) {
    if (String(err?.code).startsWith('ERR_PARSE_ARGS')) {
      console.error(`${err.message}\nСправка: node scripts/ai-review/review.mjs help`);
      return 2;
    }
    throw err;
  }

  try {
    return await spec.run(parsed);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
};

process.exitCode = await main(process.argv.slice(2));
