/**
 * review.md: человекочитаемый файл с находками и отметками. renderReview(state) → текст,
 * parseReview(text) → отметки пользователя. Чистый модуль: ни сети, ни файлов.
 *
 * Формат строки находки (ключ ‹f12› — связь с run.json, его не трогать):
 *   - [ ] P · поз. 12.3 «Утеплитель» · Δ 1,2 млн ₽ · [открыть](https://…) ‹f12›
 */

import { byMoneyDesc, clipText, FIELD_LABELS, formatDateTime, formatMoney, LABEL_RU, oneLine } from './format.mjs';

const DETAIL_LIMIT = 300;
const EVIDENCE_LIMIT = 5;

/** Разделы по метке итоговой оценки. */
const SECTIONS = [
  { id: 'likely_error', title: 'По делу — ИИ считает ошибкой', bulk: true },
  { id: 'likely_ok', title: 'Похоже на шум', bulk: true },
  { id: 'unsure', title: 'Не уверен', bulk: true },
  { id: 'unreviewed', title: 'Без разбора — находки по тендеру и справочнику', bulk: false },
];

const sectionOf = (item) => (item.combined ? item.combined.label : 'unreviewed');

const comparePosition = (a, b) =>
  (a.positionNumber ?? Infinity) - (b.positionNumber ?? Infinity) || String(a.key).localeCompare(String(b.key), 'en', { numeric: true });

const sentence = (text) => {
  const t = oneLine(text);
  return t === '' || /[.!?…]$/.test(t) ? t : `${t}.`;
};

const withBasis = (reason, basis) => {
  const base = sentence(reason);
  return basis ? `${base} Основание: ${basis}` : base;
};

/** Факты модели → «Данные: «ПСБ-С 25» цена 125, К перев. 0.05; позиция: ед. м3». */
const renderEvidence = (item) => {
  const label = item.combined?.label;
  const picked = [];
  const seen = new Set();
  for (const ai of Object.values(item.ai ?? {})) {
    if (ai.status !== 'ok' || (label !== 'unsure' && ai.label !== label)) continue;
    for (const e of ai.evidence ?? []) {
      if (e.entity === 'finding' && e.field === 'detail') continue; // и так выведено в «Правило:»
      const id = `${e.entity}:${e.entityId}:${e.field}`;
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push(e);
    }
  }
  const groups = new Map();
  for (const e of picked.slice(0, EVIDENCE_LIMIT)) {
    const groupKey = `${e.entity}:${e.entityId}`;
    const group = groups.get(groupKey) ?? { entity: e.entity, label: e.label, parts: [] };
    group.parts.push(`${FIELD_LABELS[e.field] ?? e.field} ${oneLine(clipText(e.value, 80))}`);
    groups.set(groupKey, group);
  }
  return [...groups.values()]
    .map((g) => (g.entity === 'row' ? `«${oneLine(g.label)}» ${g.parts.join(', ')}` : `${g.label}: ${g.parts.join(', ')}`))
    .join('; ');
};

const modelLine = (name, ai) => {
  if (ai.status === 'error') return `  ${name}: сбой — ${oneLine(ai.reason)}`;
  if (ai.status === 'missing') return `  ${name}: пропустил находку`;
  return `  ${name}: ${LABEL_RU[ai.label] ?? ai.label} — ${withBasis(ai.reason, ai.basis)}`;
};

const renderItem = (item, multi) => {
  const disagree = item.combined && item.combined.agree === false;
  const head = [
    `${disagree ? '⚡ ' : ''}${item.ruleCode}`,
    oneLine(item.where),
    formatMoney(item.moneyDelta),
    item.link ? `[открыть](${item.link})` : '',
  ].filter(Boolean);
  const lines = [`- [ ] ${head.join(' · ')} ‹${item.key}›`];

  if (item.combined) {
    if (multi) {
      for (const [name, ai] of Object.entries(item.ai)) lines.push(modelLine(name, ai));
    } else {
      const [ai] = Object.values(item.ai);
      if (ai.status === 'ok') lines.push(`  ИИ: ${withBasis(ai.reason, ai.basis)}`);
      else lines.push(modelLine('ИИ', ai));
    }
    const evidence = renderEvidence(item);
    if (evidence) lines.push(`  Данные: ${evidence}`);
  }
  if (item.detail) lines.push(`  Правило: ${oneLine(clipText(item.detail, DETAIL_LIMIT))}`);
  return lines.join('\n');
};

/**
 * @param {{ tender: { number: string, version: number | null, title: string }, createdAt: string,
 *   models: Array<{ name: string, model: string }>, promptVersion: string, skillsRev: string, items: any[] }} state
 * @returns {string}
 */
export const renderReview = (state) => {
  const { tender } = state;
  const multi = state.models.length > 1;
  const version = tender.version ? ` v${tender.version}` : '';
  const lines = [
    `# ИИ-проверка · тендер ${tender.number}${version} «${oneLine(tender.title)}» · ${formatDateTime(new Date(state.createdAt))}`,
    `Модели: ${state.models.map((m) => `${m.name} (${m.model})`).join(', ')} · промпт ${state.promptVersion} · навыки ${state.skillsRev}`,
    'Отметка: [+] по делу (вердикт «Ошибка») · [-] не по делу («Норма») · пусто — не решено. ' +
      'Комментарий — в конце строки после //. Отметка в заголовке раздела ставится всем неотмеченным строкам раздела.',
  ];

  for (const section of SECTIONS) {
    const items = state.items.filter((item) => sectionOf(item) === section.id);
    if (items.length === 0) continue;
    items.sort((a, b) => {
      if (section.id === 'unsure') {
        const da = a.combined.agree === false ? 0 : 1;
        const db = b.combined.agree === false ? 0 : 1;
        if (da !== db) return da - db;
      }
      return byMoneyDesc(a.moneyDelta, b.moneyDelta) || comparePosition(a, b);
    });
    lines.push('', `## ${section.bulk ? '[ ] ' : ''}${section.title} (${items.length})`, '');
    lines.push(items.map((item) => renderItem(item, multi)).join('\n\n'));
  }
  return `${lines.join('\n')}\n`;
};

// --- разбор ------------------------------------------------------------------

const ITEM_RE = /^\s*[-*]\s*\[(.?)\](.*?)‹(f\d+)›(.*)$/;
const HEADING_RE = /^##(?:\s*\[(.?)\])?/;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

/** Символ в скобках → '+', '-', '' (нет отметки) или null (непонятно). */
const markOf = (char) => {
  if (['+', 'x', 'X', '✓'].includes(char)) return '+';
  if (char === '-') return '-';
  if (char.trim() === '') return '';
  return null;
};

/** Комментарий после «//» (без «:» перед ним — это не https://); ссылки markdown не учитываются. */
const inlineComment = (rest) => {
  const clean = rest.replace(MARKDOWN_LINK_RE, (link) => ' '.repeat(link.length));
  const match = /(?<!:)\/\//.exec(clean);
  return match ? rest.slice(match.index + 2).trim() : '';
};

/**
 * @param {string} text
 * @param {{ knownKeys?: Set<string> }} [opts]
 * @returns {{ marks: Map<string, { mark: '+' | '-', comment: string, bulk: boolean }>, warnings: string[] }}
 */
export const parseReview = (text, { knownKeys } = {}) => {
  /** @type {Map<string, { mark: '+' | '-', comment: string, bulk: boolean }>} */
  const marks = new Map();
  const warnings = [];
  const seen = new Set();
  let sectionMark = '';
  let current = null; // { key, mark, comments: string[] }
  const all = [];

  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const heading = HEADING_RE.exec(line);
    if (heading) {
      current = null;
      const mark = markOf(heading[1] ?? ' ');
      if (mark === null) warnings.push(`строка ${lineNo}: непонятная отметка раздела «${heading[1]}», пропущена`);
      sectionMark = mark ?? '';
      return;
    }

    const item = ITEM_RE.exec(line);
    if (item) {
      const [, rawMark, , key, rest] = item;
      const own = markOf(rawMark);
      if (own === null) warnings.push(`строка ${lineNo}: непонятная отметка «${rawMark}» у ${key}, пропущена`);
      if (seen.has(key)) warnings.push(`строка ${lineNo}: ключ ${key} встречается повторно, учтена последняя строка`);
      seen.add(key);
      if (knownKeys && !knownKeys.has(key)) warnings.push(`строка ${lineNo}: ключ ${key} не из этого прогона, пропущен`);
      const comment = inlineComment(rest);
      current = { key, own: own ?? '', sectionMark, comments: comment ? [comment] : [], known: !knownKeys || knownKeys.has(key) };
      all.push(current);
      return;
    }

    if (current && line.trim().startsWith('//')) {
      const extra = line.trim().slice(2).trim();
      if (extra) current.comments.push(extra);
    }
  });

  for (const entry of all) {
    if (!entry.known) continue;
    const mark = entry.own || entry.sectionMark;
    if (!mark) continue;
    marks.set(entry.key, { mark, comment: entry.comments.join(' '), bulk: !entry.own });
  }
  return { marks, warnings };
};
