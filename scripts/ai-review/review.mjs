#!/usr/bin/env node
/**
 * ИИ-проверка находок «Проверки данных» скриптом на ПК, который видит офисную модель.
 *
 *   node scripts/ai-review/review.mjs help
 *   node scripts/ai-review/review.mjs ping [--models=qwen,minimax] [--quick] [--no-portal] [--bench=<тендер>]
 *   node scripts/ai-review/review.mjs run <тендер> [--models=a,b] [--rule=U,V] [--new] [--max=N] [--remarks=N | --all] [--think] [--refresh] [--no-cache] [--no-publish]
 *   node scripts/ai-review/review.mjs publish [каталог прогона] [--dry-run] [--no-auto]
 *   node scripts/ai-review/review.mjs apply <путь к review.md> [--dry-run] [--brief]
 *   node scripts/ai-review/review.mjs sync [каталог прогона] [--dry-run]
 *
 * Настройки — только в scripts/ai-review/ai-review.env (см. README.md).
 */

import { parseArgs } from 'node:util';
import { runApply } from './lib/apply.mjs';
import { runBench } from './lib/bench.mjs';
import { ConfigError, loadConfig } from './lib/env.mjs';
import { LlmError } from './lib/llm.mjs';
import { runPing } from './lib/ping.mjs';
import { PortalError } from './lib/portal.mjs';
import { runPublish } from './lib/publish.mjs';
import { runReview } from './lib/run.mjs';
import { runSync } from './lib/sync.mjs';

const HELP = `ИИ-проверка находок «Проверки данных»

Использование: node scripts/ai-review/review.mjs <команда> [флаги]

Команды:
  run <тендер>   Разобрать открытые находки моделью и собрать review.md для разметки
                 <тендер>: номер (256 — последняя версия), 256v3 или uuid
           --models=a,b   профили (по умолчанию — первая из AI_REVIEW_MODELS)
           --rule=U,V     только эти правила
           --new          только новые находки
           --max=N        первые N позиций по сумме Δ
           --remarks=N    позиций без находок для своих замечаний ИИ, самых дорогих (по умолчанию 20;
                          при --rule и --new — 0)
           --all          свои замечания ИИ по всем позициям со строками (несовместимо с --remarks)
           --think        второй проход с рассуждениями (нужен AI_REVIEW_<ИМЯ>_THINK_EXTRA)
           --refresh      пересчитать отчёт портала перед разбором
           --no-cache     не читать кэш ответов моделей
           --no-publish   не публиковать метки ИИ и не снимать шум автоматически (иначе — как publish)
  publish [каталог прогона]   Записать метки ИИ на страницу «Проверка данных» и снять явный шум
                 без каталога — последний прогон в out/
           --dry-run      показать план, ничего не отправлять и не писать
           --no-auto      только метки, без автоотсева (вердикт «Норма» по записям AI-SKILLS.md с auto: yes)
  apply <review.md>   Отправить отметки ([+] ошибка, [-] норма) в портал
           --dry-run      показать, что ушло бы, ничего не отправлять и не писать
           --brief        записать краткий итог в выжимку тендера
  sync [каталог прогона]   Забрать вердикты, поставленные на странице «Проверка данных», в журнал решений
                 (для обучения); без каталога — последний прогон в out/. В портал ничего не отправляет.
                 Если вы вернули «Ошибкой» находку, снятую автоотсевом, запись AI-SKILLS.md получает auto: paused.
                 Пишет sync.md (согласие с ИИ и расхождения) в каталог прогона
           --dry-run      показать, что записалось бы, ничего не писать
  ping   Проверить связь с порталом и моделями
           --models=a,b   профили (по умолчанию — все из AI_REVIEW_MODELS)
           --quick        без проверки контекста (быстро)
           --no-portal    не обращаться к порталу
           --bench=<тендер>   замер скорости на 20 позициях тендера и прогноз времени
  help   Эта справка

Настройки читаются только из scripts/ai-review/ai-review.env
(образец — ai-review.env.example). Подробности — README.md.`;

/** Список через запятую → массив; пусто → undefined. */
const splitList = (value, transform = (item) => item) => {
  if (!value) return undefined;
  const items = value.split(',').map((item) => transform(item.trim())).filter(Boolean);
  return items.length > 0 ? items : undefined;
};

const positional = (positionals, usage) => {
  if (positionals.length !== 1) throw new ConfigError(`Ожидается один аргумент.\nИспользование: ${usage}`);
  return positionals[0];
};

/** Набор флагов каждой команды. */
const COMMANDS = {
  run: {
    options: {
      models: { type: 'string' },
      rule: { type: 'string' },
      new: { type: 'boolean' },
      max: { type: 'string' },
      remarks: { type: 'string' },
      all: { type: 'boolean' },
      think: { type: 'boolean' },
      refresh: { type: 'boolean' },
      'no-cache': { type: 'boolean' },
      'no-publish': { type: 'boolean' },
    },
    positionals: true,
    run: async ({ values, positionals }) => {
      const tender = positional(positionals, 'node scripts/ai-review/review.mjs run <тендер> [флаги] (тендер: 256, 256v3 или uuid)');
      let max;
      if (values.max !== undefined) {
        max = Number(values.max);
        if (!Number.isInteger(max) || max <= 0) throw new ConfigError(`--max: ожидается положительное целое, указано «${values.max}»`);
      }
      let remarks;
      if (values.remarks !== undefined) {
        remarks = Number(values.remarks);
        if (!/^\d+$/.test(values.remarks.trim()) || !Number.isInteger(remarks)) {
          throw new ConfigError(`--remarks: ожидается целое число не меньше 0, указано «${values.remarks}»`);
        }
        if (values.all) throw new ConfigError('--all и --remarks=N несовместимы: --all берёт все позиции со строками');
      }
      const config = loadConfig();
      const result = await runReview(config, {
        tender,
        models: splitList(values.models, (item) => item.toLowerCase()),
        rules: splitList(values.rule, (item) => item.toUpperCase()),
        onlyNew: values.new,
        max,
        remarks,
        all: values.all,
        think: values.think,
        refresh: values.refresh,
        noCache: values['no-cache'],
      });
      if (result.code !== 0 || values['no-publish']) return result.code;
      // Файлы прогона уже записаны: сбой публикации не валит run, её можно повторить командой publish.
      try {
        if ((await runPublish(config, { dir: result.runDir })) !== 0) {
          console.warn(`ВНИМАНИЕ: публикация завершилась с ошибкой. Повторите: publish "${result.runDir}"`);
        }
      } catch (err) {
        console.warn(`ВНИМАНИЕ: публикация не удалась (${err.message}). Повторите: publish "${result.runDir}"`);
      }
      return result.code;
    },
  },
  publish: {
    options: {
      'dry-run': { type: 'boolean' },
      'no-auto': { type: 'boolean' },
    },
    positionals: true,
    run: async ({ values, positionals }) => {
      if (positionals.length > 1) {
        throw new ConfigError('Ожидается не больше одного аргумента.\nИспользование: node scripts/ai-review/review.mjs publish [каталог прогона] [--dry-run] [--no-auto]');
      }
      return runPublish(loadConfig(), { dir: positionals[0], dryRun: values['dry-run'], noAuto: values['no-auto'] });
    },
  },
  apply: {
    options: {
      'dry-run': { type: 'boolean' },
      brief: { type: 'boolean' },
    },
    positionals: true,
    run: async ({ values, positionals }) => {
      const file = positional(positionals, 'node scripts/ai-review/review.mjs apply <путь к review.md> [--dry-run] [--brief]');
      return runApply(loadConfig(), { file, dryRun: values['dry-run'], brief: values.brief });
    },
  },
  sync: {
    options: {
      'dry-run': { type: 'boolean' },
    },
    positionals: true,
    run: async ({ values, positionals }) => {
      if (positionals.length > 1) {
        throw new ConfigError('Ожидается не больше одного аргумента.\nИспользование: node scripts/ai-review/review.mjs sync [каталог прогона] [--dry-run]');
      }
      return runSync(loadConfig(), { dir: positionals[0], dryRun: values['dry-run'] });
    },
  },
  ping: {
    options: {
      models: { type: 'string' },
      quick: { type: 'boolean' },
      'no-portal': { type: 'boolean' },
      bench: { type: 'string' },
    },
    run: async ({ values }) => {
      const models = splitList(values.models, (item) => item.toLowerCase());
      if (values.bench !== undefined) return runBench(loadConfig(), { tender: values.bench, models });
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
    parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: Boolean(spec.positionals), strict: true });
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
    if (err instanceof PortalError || err instanceof LlmError) {
      console.error(`Ошибка: ${err.message}`);
      return 1;
    }
    throw err;
  }
};

process.exitCode = await main(process.argv.slice(2));
