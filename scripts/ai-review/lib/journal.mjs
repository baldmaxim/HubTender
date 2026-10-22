/**
 * Файлы применения: applied.json (что уже ушло в портал), decisions.jsonl (журнал решений),
 * itog.md (итог по прогону).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { byMoneyDesc, formatDateTime, formatMoney, oneLine } from './format.mjs';

export const JOURNAL_FILE = 'decisions.jsonl';
const APPLIED_FILE = 'applied.json';

/** Примечание вердикта: «ИИ-проверка[ (отметка раздела)][: комментарий]». */
export const buildNote = (comment, bulk) => {
  const head = bulk ? 'ИИ-проверка (отметка раздела)' : 'ИИ-проверка';
  return comment ? `${head}: ${comment}` : head;
};

/** Что уже применено из этого прогона: key → { decision, fingerprint, at, comment, bulk }. */
export const readApplied = (runDir) => {
  const file = join(runDir, APPLIED_FILE);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`${file}: файл повреждён, исправьте или удалите его`);
  }
};

export const writeApplied = (runDir, applied) => {
  writeFileSync(join(runDir, APPLIED_FILE), JSON.stringify(applied, null, 2), 'utf8');
};

/** Путь прогона относительно outDir с «/» (одинаково на Windows и Linux). */
export const relativeRun = (outDir, runDir) => relative(outDir, runDir).split(sep).join('/');

/**
 * Строка журнала решений.
 * @param {{ state: any, item: any, decision: string, comment: string, bulk: boolean, at: string, runRel: string }} p
 */
export const buildJournalLine = ({ state, item, decision, comment, bulk, at, runRel }) => ({
  at,
  tender_id: state.tender.id,
  tender: `${state.tender.number}${state.tender.version ? ` v${state.tender.version}` : ''}`,
  kind: 'finding',
  code: item.ruleCode,
  entity_type: item.entityType,
  entity_id: item.entityId,
  item_id: item.itemId,
  position_id: item.positionId,
  fingerprint: item.fingerprint,
  finding_id: item.findingId,
  money_delta: item.moneyDelta,
  ai_label: item.combined?.label ?? null,
  ai_reason: item.combined?.reason ?? null,
  ai_basis: item.combined?.basis ?? null,
  ai_by_model: Object.fromEntries(Object.entries(item.ai ?? {}).map(([name, a]) => [name, a.label])),
  decision,
  note: comment,
  bulk,
  origin: 'review',
  models: state.models.map((m) => m.name),
  prompt_version: state.promptVersion,
  skills_rev: state.skillsRev,
  run: runRel,
  snapshot: item.positionId ? `${runRel}/positions.json#${item.positionId}` : null,
});

/** Дописывает строки JSON в журнал. */
export const appendJournal = (outDir, lines) => {
  if (lines.length === 0) return;
  appendFileSync(join(outDir, JOURNAL_FILE), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf8');
};

/** Подтверждённые ошибки из применённого, по |Δ| убыванию. */
export const confirmedItems = (state, applied) =>
  state.items
    .filter((item) => applied[item.key]?.decision === 'error')
    .sort((a, b) => byMoneyDesc(a.moneyDelta, b.moneyDelta));

/** itog.md: подтверждённые со ссылками и комментариями, счётчики. */
export const renderItog = (state, applied) => {
  const confirmed = confirmedItems(state, applied);
  const rejected = state.items.filter((item) => applied[item.key]?.decision === 'accepted').length;
  const version = state.tender.version ? ` v${state.tender.version}` : '';
  const lines = [
    `# Итог ИИ-проверки · тендер ${state.tender.number}${version} «${oneLine(state.tender.title)}» · ${formatDateTime(new Date(state.createdAt))}`,
    '',
    `Подтверждено ошибок: ${confirmed.length} · отклонено (норма): ${rejected}`,
    '',
  ];
  if (confirmed.length > 0) lines.push('## Подтверждено', '');
  confirmed.forEach((item, i) => {
    const comment = applied[item.key].comment;
    const head = [item.ruleCode, oneLine(item.where), formatMoney(item.moneyDelta), item.link ? `[открыть](${item.link})` : '']
      .filter(Boolean)
      .join(' · ');
    lines.push(`${i + 1}. ${head}${comment ? ` — ${oneLine(comment)}` : ''}`);
  });
  return `${lines.join('\n')}\n`;
};
