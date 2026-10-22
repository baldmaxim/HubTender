/**
 * Команда apply: отметки из review.md → вердикты в портал, журнал решений, итог.
 *
 *   apply <путь к review.md> [--dry-run] [--brief]
 *
 * Перед отправкой каждая находка сверяется со свежим отчётом: сервер молча перезаписывает
 * прежний вердикт по (тендер, правило, сущность) даже при устаревшем отпечатке.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { updateBrief } from './brief.mjs';
import { ConfigError } from './env.mjs';
import { formatMoney } from './format.mjs';
import {
  appendJournal,
  buildJournalLine,
  buildNote,
  confirmedItems,
  readApplied,
  relativeRun,
  renderItog,
  writeApplied,
} from './journal.mjs';
import { createPortal } from './portal.mjs';
import { DEFAULT_OUT_DIR } from './paths.mjs';
import { parseReview } from './review-md.mjs';
import { loadQuality } from './tender.mjs';

const BATCH_SIZE = 500;
const VERDICT_RU = { error: 'Ошибка', accepted: 'Норма' };

/**
 * Что отправить, а что пропустить. Чистая функция.
 * @param {{ state: any, marks: Map<string, any>, fresh: Map<string, any>, applied: Record<string, any> }} p
 */
export const planApply = ({ state, marks, fresh, applied }) => {
  const send = [];
  const skipped = [];
  const same = [];
  let done = 0;
  for (const item of state.items) {
    const entry = marks.get(item.key);
    if (!entry) continue;
    const decision = entry.mark === '+' ? 'error' : 'accepted';
    const prior = applied[item.key];
    if (prior) {
      // Вердикт этого прогона уже в портале; передумали — менять на странице, а не повторным apply.
      if (prior.decision === decision) done += 1;
      else skipped.push({ key: item.key, item, reason: `отметка изменена после apply — в портале уже «${VERDICT_RU[prior.decision]}», поменяйте вердикт на странице` });
      continue;
    }
    const current = fresh.get(`${item.ruleCode}|${item.entityId}`);
    if (!current) {
      skipped.push({ key: item.key, item, reason: 'находки больше нет' });
    } else if (current.fingerprint !== item.fingerprint) {
      skipped.push({ key: item.key, item, reason: 'данные изменились после прогона' });
    } else if (current.verdict && current.verdict !== decision) {
      skipped.push({ key: item.key, item, reason: `в портале уже стоит другой вердикт («${VERDICT_RU[current.verdict] ?? current.verdict}»)` });
    } else if (current.verdict === decision) {
      same.push({ key: item.key, item, decision });
    } else {
      send.push({
        key: item.key,
        item,
        decision,
        comment: entry.comment,
        bulk: entry.bulk,
        note: buildNote(entry.comment, entry.bulk),
      });
    }
  }
  return { send, skipped, same, done };
};

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const printPlan = (plan, log, dryRun) => {
  if (plan.send.length > 0) {
    log(dryRun ? 'Было бы отправлено:' : 'К отправке:');
    for (const { key, item, decision, note } of plan.send) {
      log(`  ${key}  ${item.ruleCode}  ${item.where}  ${formatMoney(item.moneyDelta)}  → ${VERDICT_RU[decision]}  «${note}»`);
    }
  }
  for (const { key, item, reason } of plan.skipped) log(`ПРОПУЩЕНО ${key} (${item.ruleCode}, ${item.where}): ${reason}`);
  if (plan.same.length > 0) log(`Уже стоит тот же вердикт, не отправляется: ${plan.same.length}`);
  if (plan.done > 0) log(`Уже применено ранее: ${plan.done}`);
};

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ file: string, dryRun?: boolean, brief?: boolean }} args
 * @param {{ portal?: any, outDir?: string, now?: () => Date, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>} код выхода
 */
export const runApply = async (config, args, deps = {}) => {
  const { outDir = DEFAULT_OUT_DIR, now = () => new Date(), log = (line) => console.log(line) } = deps;
  const reviewPath = resolve(args.file);
  if (!existsSync(reviewPath)) throw new ConfigError(`Нет файла ${reviewPath}`);
  const runDir = dirname(reviewPath);
  const statePath = join(runDir, 'run.json');
  if (!existsSync(statePath)) throw new ConfigError(`Рядом с review.md нет run.json (${statePath}): apply работает только с файлом прогона`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  const { marks, warnings } = parseReview(readFileSync(reviewPath, 'utf8'), {
    knownKeys: new Set(state.items.map((item) => item.key)),
  });
  for (const warning of warnings) log(`ВНИМАНИЕ: ${warning}`);
  log(`Тендер ${state.tender.number}${state.tender.version ? ` v${state.tender.version}` : ''}, отметок: ${marks.size}`);

  const portal = deps.portal ?? createPortal(config.portal);
  const applied = readApplied(runDir);
  const report = await loadQuality(portal, state.tender.id);
  const fresh = new Map(report.findings.map((f) => [`${f.rule_code}|${f.entity_id}`, f]));
  const plan = planApply({ state, marks, fresh, applied });
  printPlan(plan, log, Boolean(args.dryRun));

  if (args.dryRun) {
    log(`Пробный запуск: ничего не отправлено и не записано. К отправке: ${plan.send.length}, пропущено: ${plan.skipped.length}.`);
    return 0;
  }

  let failed = false;
  let sent = 0;
  const runRel = relativeRun(outDir, runDir);
  for (const batch of chunks(plan.send, BATCH_SIZE)) {
    try {
      await portal.post(`/api/v1/tenders/${state.tender.id}/quality/verdicts`, {
        items: batch.map(({ item, decision, note }) => ({
          rule_code: item.ruleCode,
          entity_id: item.entityId,
          fingerprint: item.fingerprint,
          verdict: decision,
          note,
        })),
      });
    } catch (err) {
      log(`ОШИБКА отправки: ${err.message}`);
      log(`Отправлено до сбоя: ${sent}, не отправлено: ${plan.send.length - sent}. Повторный apply доотправит остаток.`);
      failed = true;
      break;
    }
    const at = now().toISOString();
    for (const { key, item, decision, comment, bulk } of batch) {
      applied[key] = { decision, fingerprint: item.fingerprint, at, comment, bulk };
    }
    writeApplied(runDir, applied);
    appendJournal(
      outDir,
      batch.map(({ item, decision, comment, bulk }) => buildJournalLine({ state, item, decision, comment, bulk, at, runRel })),
    );
    sent += batch.length;
  }

  if (Object.keys(applied).length > 0) writeFileSync(join(runDir, 'itog.md'), renderItog(state, applied), 'utf8');
  log(`Отправлено: ${sent}, пропущено: ${plan.skipped.length}.${sent > 0 ? ` Итог: ${join(runDir, 'itog.md')}` : ''}`);

  if (args.brief && !failed) {
    if (Object.keys(applied).length === 0) {
      log('Выжимка не менялась: нет применённых решений.');
    } else {
      try {
        await updateBrief(portal, state.tender.id, {
          tender: state.tender,
          confirmed: confirmedItems(state, applied),
          rejected: Object.values(applied).filter((a) => a.decision === 'accepted').length,
          date: now(),
        });
        log('Выжимка тендера обновлена.');
      } catch (err) {
        log(`ОШИБКА обновления выжимки: ${err.message}`);
        failed = true;
      }
    }
  }
  return failed ? 1 : 0;
};
