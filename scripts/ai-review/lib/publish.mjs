/**
 * Команда publish: метки ИИ на странице «Проверка данных» и автоотсев явного шума.
 *
 *   publish [каталог прогона] [--dry-run] [--no-auto]
 *
 * 1. Метки ИИ (likely_error / likely_ok / unsure) по всем разобранным находкам прогона уходят в
 *    POST /tenders/{id}/verification/ai-assessments; сервер сам пропускает закрытые находки и устаревшие отпечатки.
 * 2. Автоотсев: находки, которые ИИ уверенно считает нормой по записи AI-SKILLS.md с «auto: yes»,
 *    получают вердикт «Норма» через /quality/verdicts (как в apply, со сверкой со свежим отчётом).
 *    Включает автоотсев человек — правкой AI-SKILLS.md; такие вердикты в журнале помечены kind «auto».
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_AUTO_MAX_RUB, ConfigError } from './env.mjs';
import { clipText, formatMoney, oneLine } from './format.mjs';
import { appendJournal, buildJournalLine, readApplied, relativeRun, renderItog, writeApplied } from './journal.mjs';
import { DEFAULT_OUT_DIR } from './paths.mjs';
import { createPortal } from './portal.mjs';
import { loadQuality } from './tender.mjs';

const BATCH_SIZE = 500;
const LABELS = ['likely_error', 'likely_ok', 'unsure'];
const LABEL_SHORT = { likely_error: 'по делу', likely_ok: 'норма', unsure: 'не уверен' };

// Пределы контракта ai-assessments.
const MODEL_ID_LIMIT = 200;
const PROMPT_VERSION_LIMIT = 100;
const REASON_LIMIT = 2000;
const EVIDENCE_LIMIT = 10;
const EVIDENCE_REF_LIMIT = 200;
const EVIDENCE_VALUE_LIMIT = 500;
// В /quality/verdicts предела note нет (apply его не режет); автоноту держим короткой.
const AUTO_NOTE_LIMIT = 500;

/** Свежие находки отчёта портала: Map «правило|сущность» → находка (как в apply). */
export const indexFresh = (report) => new Map(report.findings.map((f) => [`${f.rule_code}|${f.entity_id}`, f]));

const freshOf = (fresh, item) => fresh.get(`${item.ruleCode}|${item.entityId}`);

/** Факты моделей, согласных с итоговой оценкой (при «не уверен» — всех ответивших), без повторов, не больше 10. */
const collectEvidence = (item) => {
  const label = item.combined.label;
  const seen = new Set();
  const out = [];
  for (const ai of Object.values(item.ai ?? {})) {
    if (ai.status !== 'ok' || (label !== 'unsure' && ai.label !== label)) continue;
    for (const e of ai.evidence ?? []) {
      const id = `${e.entity}:${e.entityId}:${e.field}:${e.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        ref: clipText(e.label ? `${e.label} · ${e.field}` : e.ref, EVIDENCE_REF_LIMIT),
        value: clipText(String(e.value), EVIDENCE_VALUE_LIMIT),
      });
      if (out.length >= EVIDENCE_LIMIT) return out;
    }
  }
  return out;
};

/**
 * Какие метки ИИ отправить. Чистая функция.
 * В отчёте портала находка должна быть с тем же отпечатком, что в прогоне.
 * @param {any} state run.json
 * @param {Map<string, any>} fresh см. indexFresh
 * @returns {{ modelId: string, promptVersion: string,
 *   entries: Array<{ key: string, item: any, payload: { finding_id: string, fingerprint: string, label: string, reason: string, evidence: Array<{ ref: string, value: string }> } }>,
 *   skipped: number }}
 */
export const planAssessments = (state, fresh) => {
  const entries = [];
  let skipped = 0;
  for (const item of state.items) {
    if (!LABELS.includes(item.combined?.label)) continue;
    const current = freshOf(fresh, item);
    if (!current || current.fingerprint !== item.fingerprint) {
      skipped += 1;
      continue;
    }
    entries.push({
      key: item.key,
      item,
      payload: {
        finding_id: current.finding_id ?? item.findingId,
        fingerprint: item.fingerprint,
        label: item.combined.label,
        reason: clipText(item.combined.reason ?? '', REASON_LIMIT),
        evidence: collectEvidence(item),
      },
    });
  }
  const rev = state.skillsRev ? `@${state.skillsRev}` : '';
  return {
    modelId: clipText(state.models.map((m) => m.model ?? m.name).join(' + '), MODEL_ID_LIMIT),
    promptVersion: clipText(`ext:${state.promptVersion}${rev}`, PROMPT_VERSION_LIMIT),
    entries,
    skipped,
  };
};

/**
 * Код записи навыков, по которому находку можно снять автоматически; null — нельзя.
 * Все ответившие модели: «норма», без downgraded и с одним и тем же основанием — записью с auto: yes
 * по тому же правилу, что у находки.
 */
const autoCodeOf = (item, entries, maxRub) => {
  if (item.combined?.label !== 'likely_ok') return null;
  const answered = Object.values(item.ai ?? {}).filter((a) => a.status === 'ok');
  if (answered.length === 0) return null;
  if (answered.some((a) => a.label !== 'likely_ok' || a.downgraded)) return null;
  const code = answered[0].basis;
  if (!code || answered.some((a) => a.basis !== code)) return null;
  const entry = entries.find((e) => e.code === code);
  if (!entry || entry.auto !== 'yes' || entry.status !== 'active') return null;
  // Основание другого правила или собственное замечание ИИ (rule: null) находку этого правила не закрывает.
  if (entry.rule !== item.ruleCode) return null;
  // Сумма неизвестна — не «мало», автоматически не снимаем.
  const delta = item.moneyDelta === null || item.moneyDelta === undefined ? NaN : Math.abs(Number(item.moneyDelta));
  if (!Number.isFinite(delta) || delta >= maxRub) return null;
  return code;
};

/**
 * Что снять автоматически вердиктом «Норма». Чистая функция.
 * Находка должна быть в свежем отчёте с тем же отпечатком и без какого-либо вердикта (ни «Ошибка», ни «Норма»).
 * @param {any} state run.json
 * @param {Map<string, any>} fresh см. indexFresh
 * @param {{ entries: any[] }} skills результат loadSkills / parseSkills
 * @param {{ maxRub?: number, applied?: Record<string, any> }} [opts] applied — applied.json прогона
 * @returns {{ send: Array<{ key: string, item: any, code: string, note: string }>, done: number }}
 */
export const planAuto = (state, fresh, skills, { maxRub = DEFAULT_AUTO_MAX_RUB, applied = {} } = {}) => {
  const send = [];
  let done = 0;
  for (const item of state.items) {
    const code = autoCodeOf(item, skills.entries, maxRub);
    if (!code) continue;
    if (applied[item.key]) {
      if (applied[item.key].auto) done += 1;
      continue;
    }
    const current = freshOf(fresh, item);
    if (!current || current.fingerprint !== item.fingerprint || current.verdict) continue;
    send.push({ key: item.key, item, code, note: clipText(oneLine(`ИИ-авто: ${code} — ${item.combined.reason}`), AUTO_NOTE_LIMIT) });
  }
  return { send, done };
};

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** «GA-1 ×3, GA-3 ×1» по кодам записей. */
const byCodeText = (send) => {
  const counts = new Map();
  for (const { code } of send) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, n]) => `${code} ×${n}`).join(', ');
};

/**
 * Последний прогон в out: папки <тендер>/<ГГГГ-ММ-ДД_ЧЧММ[-n]> с run.json, самая поздняя по имени метки.
 * @returns {string | null}
 */
export const findLatestRun = (outDir) => {
  if (!existsSync(outDir)) return null;
  let best = null;
  for (const tender of readdirSync(outDir, { withFileTypes: true })) {
    if (!tender.isDirectory()) continue;
    for (const run of readdirSync(join(outDir, tender.name), { withFileTypes: true })) {
      if (!run.isDirectory() || !existsSync(join(outDir, tender.name, run.name, 'run.json'))) continue;
      if (best === null || run.name > best.name) best = { name: run.name, dir: join(outDir, tender.name, run.name) };
    }
  }
  return best?.dir ?? null;
};

/** Каталог прогона: аргумент (папка либо файл внутри неё) или последний прогон. */
const resolveRunDir = (arg, outDir) => {
  if (!arg) {
    const latest = findLatestRun(outDir);
    if (!latest) throw new ConfigError(`В ${outDir} нет прогонов: сначала run <тендер>`);
    return latest;
  }
  const path = resolve(arg);
  if (!existsSync(path)) throw new ConfigError(`Нет каталога ${path}`);
  const dir = statSync(path).isDirectory() ? path : dirname(path);
  if (!existsSync(join(dir, 'run.json'))) throw new ConfigError(`В ${dir} нет run.json: publish работает только с папкой прогона`);
  return dir;
};

const labelCounts = (entries) =>
  LABELS.map((label) => `${LABEL_SHORT[label]} ${entries.filter((e) => e.payload.label === label).length}`).join(' · ');

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ dir?: string, dryRun?: boolean, noAuto?: boolean }} args
 * @param {{ portal?: any, outDir?: string, skills?: { entries: any[] }, now?: () => Date, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>} код выхода
 */
export const runPublish = async (config, args = {}, deps = {}) => {
  const { outDir = DEFAULT_OUT_DIR, now = () => new Date(), log = (line) => console.log(line) } = deps;
  const runDir = resolveRunDir(args.dir, outDir);
  const state = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const maxRub = config.autoMaxRub ?? DEFAULT_AUTO_MAX_RUB;
  log(`Тендер ${state.tender.number}${state.tender.version ? ` v${state.tender.version}` : ''}, прогон ${runDir}`);

  let skills = { entries: [] };
  if (!args.noAuto) {
    try {
      skills = deps.skills ?? (await import('./skills.mjs')).loadSkills();
    } catch (err) {
      throw new ConfigError(`docs/data-quality/AI-SKILLS.md не разобран: ${err.message}`);
    }
  }

  const portal = deps.portal ?? createPortal(config.portal);
  const applied = readApplied(runDir);
  const report = await loadQuality(portal, state.tender.id);
  const fresh = indexFresh(report);
  const plan = planAssessments(state, fresh);
  const auto = args.noAuto ? { send: [], done: 0 } : planAuto(state, fresh, skills, { maxRub, applied });

  log(
    `Меток ИИ к записи: ${plan.entries.length} (${labelCounts(plan.entries)}), ` +
      `не совпал отпечаток или находки нет: ${plan.skipped}`,
  );
  if (!args.noAuto) {
    log(`Автоотсев (порог |Δ| < ${maxRub} ₽): к снятию ${auto.send.length}${auto.done > 0 ? `, уже снято ранее ${auto.done}` : ''}`);
    for (const { key, item, note } of auto.send) {
      log(`  ${key}  ${item.ruleCode}  ${item.where}  ${formatMoney(item.moneyDelta)}  → Норма  «${note}»`);
    }
  }

  if (args.dryRun) {
    log('Пробный запуск: ничего не отправлено и не записано.');
    return 0;
  }

  let failed = false;
  let saved = 0;
  let skippedByServer = 0;
  for (const batch of chunks(plan.entries, BATCH_SIZE)) {
    try {
      const res = await portal.post(`/api/v1/tenders/${state.tender.id}/verification/ai-assessments`, {
        model_id: plan.modelId,
        prompt_version: plan.promptVersion,
        items: batch.map((e) => e.payload),
      });
      saved += Number.isFinite(res?.saved) ? res.saved : batch.length;
      skippedByServer += Number.isFinite(res?.skipped) ? res.skipped : 0;
    } catch (err) {
      log(`ОШИБКА записи меток ИИ: ${err.message}`);
      log(`Записано до сбоя: ${saved}. Повторный publish запишет метки заново (на сервере они обновляются).`);
      failed = true;
      break;
    }
  }

  const runRel = relativeRun(outDir, runDir);
  let removed = [];
  for (const batch of chunks(auto.send, BATCH_SIZE)) {
    try {
      await portal.post(`/api/v1/tenders/${state.tender.id}/quality/verdicts`, {
        items: batch.map(({ item, note }) => ({
          rule_code: item.ruleCode,
          entity_id: item.entityId,
          fingerprint: item.fingerprint,
          verdict: 'accepted',
          note,
        })),
      });
    } catch (err) {
      log(`ОШИБКА автоотсева: ${err.message}`);
      log(`Снято до сбоя: ${removed.length}, не снято: ${auto.send.length - removed.length}. Повторный publish доотправит остаток.`);
      failed = true;
      break;
    }
    const at = now().toISOString();
    for (const { key, item, code, note } of batch) {
      applied[key] = { decision: 'accepted', fingerprint: item.fingerprint, at, comment: note, bulk: false, auto: true, code };
    }
    writeApplied(runDir, applied);
    appendJournal(
      outDir,
      batch.map(({ item, code, note }) => ({
        ...buildJournalLine({ state, item, decision: 'accepted', comment: note, bulk: false, at, runRel }),
        kind: 'auto',
        origin: 'auto',
        auto_code: code,
      })),
    );
    removed = removed.concat(batch);
  }
  if (removed.length > 0) writeFileSync(join(runDir, 'itog.md'), renderItog(state, applied), 'utf8');

  log(
    `Метки ИИ: записано ${saved}, пропущено ${plan.skipped + skippedByServer}; ` +
      `снято автоматически: ${removed.length}${removed.length > 0 ? ` (по записям: ${byCodeText(removed)})` : ''}`,
  );
  return failed ? 1 : 0;
};
