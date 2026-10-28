/**
 * Команда sync: вердикты «Ошибка»/«Норма», поставленные на странице «Проверка данных», → журнал решений.
 *
 *   sync [каталог прогона] [--dry-run]
 *
 * В портал ничего не отправляется: скрипт только забирает из свежего отчёта вердикты по находкам прогона
 * (рядом на странице видны метки ИИ) и записывает их в decisions.jsonl с origin «page» для обучения.
 * Вердикт, снятый автоотсевом ИИ и переставленный человеком в «Ошибку», — откат автоотсева: запись
 * AI-SKILLS.md, по которой находку сняли, переводится в «auto: paused».
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from './env.mjs';
import { byMoneyDesc, formatDateTime, formatMoney, LABEL_RU, oneLine } from './format.mjs';
import { appendJournal, buildJournalLine, readApplied, relativeRun, renderItog, writeApplied } from './journal.mjs';
import { DEFAULT_OUT_DIR } from './paths.mjs';
import { createPortal } from './portal.mjs';
import { indexFresh, resolveRunDir } from './publish.mjs';
import { applySkillEdits, SKILLS_PATH } from './skills.mjs';
import { loadQuality } from './tender.mjs';

const VERDICT_RU = { error: 'Ошибка', accepted: 'Норма' };
const VERDICT_LOW = { error: 'ошибка', accepted: 'норма' };

const AUTO_PREFIX = 'ИИ-авто';
const APPLY_PREFIX = 'ИИ-проверка';
const BULK_PREFIX = 'ИИ-массово';
const BULK_PREFIX_RE = /^ИИ-массово\s*[:—–-]?\s*/;

const startsWith = (note, prefix) => note.trimStart().startsWith(prefix);

/** Примечание человека без служебного префикса «ИИ-массово». */
const stripPrefix = (note) => oneLine(note.trimStart().replace(BULK_PREFIX_RE, ''));

/**
 * Что записать в журнал. Чистая функция.
 * Находка прогона берётся, если в свежем отчёте она с тем же отпечатком и у неё есть вердикт.
 * @param {any} state run.json
 * @param {Map<string, any>} fresh см. indexFresh
 * @param {Record<string, any>} applied applied.json прогона
 * @returns {{ actions: Array<{ key: string, item: any, decision: string, comment: string, bulk: boolean, rollbackCode: string | null, rollback: boolean }>,
 *   matched: Array<{ key: string, item: any, verdict: string, note: string, autoSieved: boolean }> }}
 *   matched — все сопоставленные находки с вердиктом (и уже бывшие в журнале): общая картина прогона
 */
export const planSync = (state, fresh, applied = {}) => {
  const actions = [];
  const matched = [];
  for (const item of state.items) {
    const current = fresh.get(`${item.ruleCode}|${item.entityId}`);
    if (!current || current.fingerprint !== item.fingerprint || !current.verdict) continue;
    const decision = current.verdict;
    const note = String(current.note ?? '');
    const prior = applied[item.key];
    const bulk = startsWith(note, BULK_PREFIX);

    // Откат автоотсева: ИИ снял в «Норму», человек поставил «Ошибку». Примечание «ИИ-авто…» тут не мешает.
    if (prior?.auto === true && decision === 'error') {
      matched.push({ key: item.key, item, verdict: decision, note, autoSieved: false });
      actions.push({
        key: item.key,
        item,
        decision,
        comment: startsWith(note, AUTO_PREFIX) ? '' : stripPrefix(note),
        bulk,
        rollback: true,
        rollbackCode: prior.code ?? null,
      });
      continue;
    }

    matched.push({ key: item.key, item, verdict: decision, note, autoSieved: startsWith(note, AUTO_PREFIX) && decision === 'accepted' });
    if (startsWith(note, AUTO_PREFIX)) continue; // автоотсев: свой журнал (kind «auto»)
    if (startsWith(note, APPLY_PREFIX)) continue; // пришло из apply, уже в журнале
    if (prior?.decision === decision) continue; // повторный sync ничего не дублирует
    actions.push({ key: item.key, item, decision, comment: stripPrefix(note), bulk, rollback: false, rollbackCode: null });
  }
  return { actions, matched };
};

/** Класс согласия «ИИ / человек» для сводки. */
const agreementOf = ({ item, verdict }) => {
  const label = item.combined?.label ?? null;
  if (label === 'likely_error') return verdict === 'error' ? 'err-err' : 'err-ok';
  if (label === 'likely_ok') return verdict === 'accepted' ? 'ok-ok' : 'ok-err';
  if (label === 'unsure') return verdict === 'error' ? 'unsure-err' : 'unsure-ok';
  return 'none';
};

const AGREEMENT_ROWS = [
  ['err-err', 'ИИ ошибка / вы ошибка'],
  ['err-ok', 'ИИ ошибка / вы норма'],
  ['ok-ok', 'ИИ норма / вы норма'],
  ['ok-err', 'ИИ норма / вы ошибка'],
  ['unsure-err', 'ИИ не уверен → ошибка'],
  ['unsure-ok', 'ИИ не уверен → норма'],
  ['none', 'без вердикта ИИ (без разбора)'],
];
const DIVERGENT = new Set(['err-ok', 'ok-err', 'unsure-err', 'unsure-ok']);

/**
 * Сводка согласия ИИ и человека. Снятое автоотсевом не считается: это не решение человека.
 * @returns {{ counts: Record<string, number>, total: number, auto: number, divergent: any[] }}
 */
export const summarize = (matched) => {
  const counts = Object.fromEntries(AGREEMENT_ROWS.map(([id]) => [id, 0]));
  const divergent = [];
  let auto = 0;
  for (const entry of matched) {
    if (entry.autoSieved) {
      auto += 1;
      continue;
    }
    const id = agreementOf(entry);
    counts[id] += 1;
    if (DIVERGENT.has(id)) divergent.push({ ...entry, agreement: id });
  }
  divergent.sort((a, b) => byMoneyDesc(a.item.moneyDelta, b.item.moneyDelta));
  return { counts, total: matched.length - auto, auto, divergent };
};

const tableLines = (summary) => [
  '| Согласие | Находок |',
  '| --- | ---: |',
  ...AGREEMENT_ROWS.map(([id, title]) => `| ${title} | ${summary.counts[id]} |`),
  `| Всего с вердиктом | ${summary.total} |`,
];

const divergenceLines = (summary) => {
  const titles = Object.fromEntries(AGREEMENT_ROWS);
  const lines = ['## Расхождения', ''];
  if (summary.divergent.length === 0) {
    lines.push('Расхождений нет.');
    return lines;
  }
  summary.divergent.forEach(({ key, item, verdict, note, agreement }, i) => {
    const head = [`${key}`, item.ruleCode, oneLine(item.where), formatMoney(item.moneyDelta)].filter(Boolean).join(' · ');
    lines.push(`${i + 1}. ${head} — ${titles[agreement]}`);
    lines.push(`   - Вы: ${VERDICT_RU[verdict]}${note ? ` — «${oneLine(note)}»` : ''}`);
    const c = item.combined;
    const label = LABEL_RU[c?.label] ?? '—';
    lines.push(`   - ИИ: ${label}${c?.reason ? ` — ${oneLine(c.reason)}` : ''}${c?.basis ? ` (основание: ${oneLine(c.basis)})` : ''}`);
    if (item.link) lines.push(`   - [открыть](${item.link})`);
  });
  return lines;
};

/** sync.md: заголовок, таблица согласия, расхождения. */
export const renderSync = (state, summary, date) => {
  const version = state.tender.version ? ` v${state.tender.version}` : '';
  return `${[
    `# Синхронизация вердиктов · тендер ${state.tender.number}${version} «${oneLine(state.tender.title)}» · ${formatDateTime(date)}`,
    '',
    ...tableLines(summary),
    ...(summary.auto > 0 ? ['', `Снято автоотсевом ИИ (в таблицу не входит): ${summary.auto}`] : []),
    '',
    ...divergenceLines(summary),
  ].join('\n')}\n`;
};

/**
 * Откат автоотсева в навыках: записи → «auto: paused». Файла нет или правка не удалась — предупреждение.
 * @returns {string[]} коды переведённых записей
 */
const pauseSkills = (codes, skillsPath, log) => {
  if (codes.length === 0) return [];
  if (!existsSync(skillsPath)) {
    log(`ВНИМАНИЕ: нет файла навыков ${skillsPath}, автоотсев по записям ${codes.join(', ')} остановите вручную (auto: paused)`);
    return [];
  }
  const text = readFileSync(skillsPath, 'utf8');
  const result = applySkillEdits(text, codes.map((code) => ({ op: 'set-auto', code, auto: 'paused' })));
  for (const error of result.errors) log(`ВНИМАНИЕ: ${error}`);
  if (result.text !== text) writeFileSync(skillsPath, result.text, 'utf8');
  return codes.filter((code) => result.applied.includes(`set-auto ${code} paused`));
};

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ dir?: string, dryRun?: boolean }} args
 * @param {{ portal?: any, outDir?: string, skillsPath?: string, now?: () => Date, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>} код выхода
 */
export const runSync = async (config, args = {}, deps = {}) => {
  const { outDir = DEFAULT_OUT_DIR, skillsPath = SKILLS_PATH, now = () => new Date(), log = (line) => console.log(line) } = deps;
  const runDir = resolveRunDir(args.dir, outDir);
  const state = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  log(`Тендер ${state.tender.number}${state.tender.version ? ` v${state.tender.version}` : ''}, прогон ${runDir}`);

  const portal = deps.portal ?? createPortal(config.portal);
  const applied = readApplied(runDir);
  const report = await loadQuality(portal, state.tender.id);
  const { actions, matched } = planSync(state, indexFresh(report), applied);
  const summary = summarize(matched);
  const rollbacks = actions.filter((a) => a.rollback);

  log(`Вердиктов со страницы к записи в журнал: ${actions.length} (откатов автоотсева: ${rollbacks.length})`);
  for (const { key, item, decision, comment, bulk, rollback } of actions) {
    const tags = [bulk ? 'массово' : '', rollback ? 'откат автоотсева' : ''].filter(Boolean).join(', ');
    log(`  ${key}  ${item.ruleCode}  ${item.where}  ${formatMoney(item.moneyDelta)}  → ${VERDICT_RU[decision]}${tags ? ` (${tags})` : ''}${comment ? `  «${comment}»` : ''}`);
  }
  const codes = [...new Set(rollbacks.map((a) => a.rollbackCode).filter(Boolean))];
  for (const code of codes) log(`ВНИМАНИЕ: человек вернул находку, снятую автоотсевом по записи ${code}; запись будет остановлена (auto: paused)`);
  for (const a of rollbacks.filter((r) => !r.rollbackCode)) log(`ВНИМАНИЕ: ${a.key}: в applied.json нет кода записи навыков — остановите автоотсев вручную`);

  const text = renderSync(state, summary, now());
  if (args.dryRun) {
    log(text.trimEnd());
    log('Пробный запуск: ничего не записано.');
    return 0;
  }

  if (actions.length > 0) {
    const at = now().toISOString();
    const runRel = relativeRun(outDir, runDir);
    for (const { key, item, decision, comment, bulk } of actions) {
      applied[key] = { decision, fingerprint: item.fingerprint, at, comment, origin: 'page', bulk };
    }
    writeApplied(runDir, applied);
    appendJournal(
      outDir,
      actions.map(({ item, decision, comment, bulk }) =>
        buildJournalLine({ state, item, decision, comment, bulk, at, runRel, origin: 'page' }),
      ),
    );
    writeFileSync(join(runDir, 'itog.md'), renderItog(state, applied), 'utf8');
  }
  const paused = pauseSkills(codes, skillsPath, log);
  if (paused.length > 0) log(`AI-SKILLS.md: auto: paused — ${paused.join(', ')}. Закоммитьте правку, чтобы остановить автоотсев и для других.`);

  const file = join(runDir, 'sync.md');
  writeFileSync(file, text, 'utf8');
  log(`Записано в журнал: ${actions.length}.`);
  for (const line of tableLines(summary)) log(line);
  log(`Расхождений: ${summary.divergent.length}. Подробности: ${file}`);
  return 0;
};
