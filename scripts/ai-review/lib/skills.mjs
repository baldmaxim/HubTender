// Навыки ИИ: разбор и правка базы знаний docs/data-quality/AI-SKILLS.md.
// Файл — markdown: преамбула и записи вида «## <код> · <название>», под заголовком — мета-комментарий
// «<!-- kind: rule; rule: GA; status: active; auto: no; added: 2026-10-22 -->» и тело записи.
// Модуль правит файл только целыми записями по коду; всё, чего правка не касается
// (преамбула, другие записи, концы строк LF/CRLF), остаётся байт-в-байт.
// Чтение файла — только в loadSkills; parseSkills и applySkillEdits работают с текстом.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Абсолютный путь к базе знаний. */
export const SKILLS_PATH = fileURLToPath(new URL('../../../docs/data-quality/AI-SKILLS.md', import.meta.url));

/**
 * @typedef {'rule' | 'exception' | 'remark'} SkillKind
 *
 * @typedef {object} SkillEntry
 * @property {string} code «GA», «GA-1» или «AI-001»
 * @property {string} title
 * @property {SkillKind} kind
 * @property {string | null} rule код правила; у remark — null
 * @property {'active' | 'retired'} status
 * @property {'no' | 'yes' | 'paused'} auto
 * @property {string | null} added ГГГГ-ММ-ДД
 * @property {Record<string, string>} meta все пары мета-комментария как есть (пусто, если меты нет)
 * @property {string} body тело записи без заголовка и мета-строки, без хвостовых пустых строк
 */

const KINDS = ['rule', 'exception', 'remark'];
const STATUSES = ['active', 'retired'];
const AUTOS = ['no', 'yes', 'paused'];
const AUTO_SETTABLE = ['paused', 'no'];

const HEADER_RE = /^## (\S+) · (\S.*?)\s*$/;
const META_RE = /^<!--(.*)-->\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const EOL_END_RE = /(\r\n|\n|\r)$/;

/** Вид записи по шаблону кода; null — код не подходит ни под один шаблон. */
const kindByCode = (code) => {
  if (/^AI-\d{3}$/.test(code)) return 'remark';
  if (/^[A-Z]{1,3}-\d+$/.test(code)) return 'exception';
  if (/^[A-Z]{1,3}$/.test(code)) return 'rule';
  return null;
};

/** Строки текста вместе с их концами (LF, CRLF или CR). Пустой текст — пустой массив. */
const splitRaw = (text) => text.split(/(?<=\n)|(?<=\r)(?!\n)/).filter((s) => s !== '');

/** Содержимое строки без конца. */
const content = (raw) => raw.replace(EOL_END_RE, '');

const isBlank = (raw) => content(raw).trim() === '';

/** Первый встретившийся в тексте конец строки; по умолчанию LF. */
const detectEol = (text) => /\r\n|\n|\r/.exec(text)?.[0] ?? '\n';

/** Есть ли в теле строка «## » вне блоков кода — такая строка при разборе стала бы заголовком записи. */
const hasBareH2 = (body) => {
  let inFence = false;
  for (const line of body.split('\n')) {
    if (!inFence && line.startsWith('## ')) return true;
    if (FENCE_RE.test(line)) inFence = !inFence;
  }
  return false;
};

/** Пары «ключ: значение» из мета-комментария. */
const parseMetaPairs = (inner, lineNo) => {
  const meta = {};
  for (const piece of inner.split(';')) {
    const part = piece.trim();
    if (part === '') continue;
    const idx = part.indexOf(':');
    if (idx <= 0) throw new Error(`AI-SKILLS: строка ${lineNo}: в мете «${part}» нет пары «ключ: значение»`);
    meta[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return meta;
};

const metaLine = (meta) => `<!-- ${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('; ')} -->`;

/** Собирает запись из заголовка, меты и тела; до разбора никаких проверок значений. */
const makeEntry = (code, title, rawLines, startLine) => {
  const lines = rawLines.map(content);
  const metaMatch = lines.length > 1 ? META_RE.exec(lines[1]) : null;
  const meta = metaMatch ? parseMetaPairs(metaMatch[1], startLine + 1) : {};
  let bodyLines = lines.slice(metaMatch ? 2 : 1);
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines = bodyLines.slice(0, -1);

  const byCode = kindByCode(code);
  const kind = meta.kind ?? byCode;
  if (!KINDS.includes(kind)) throw new Error(`AI-SKILLS: строка ${startLine}: неизвестный kind «${kind}» у ${code}`);
  if (byCode !== kind) throw new Error(`AI-SKILLS: строка ${startLine}: код ${code} не подходит виду «${kind}»`);
  const status = meta.status ?? 'active';
  if (!STATUSES.includes(status)) throw new Error(`AI-SKILLS: строка ${startLine}: неизвестный status «${status}» у ${code}`);
  const auto = meta.auto ?? 'no';
  if (!AUTOS.includes(auto)) throw new Error(`AI-SKILLS: строка ${startLine}: неизвестный auto «${auto}» у ${code}`);
  const rule = kind === 'remark' ? null : (meta.rule ?? (kind === 'rule' ? code : code.split('-')[0]));

  return { code, title, kind, rule, status, auto, added: meta.added ?? null, meta, body: bodyLines.join('\n'), hasMeta: metaMatch !== null };
};

/**
 * Разбор файла на преамбулу и записи, с сохранением сырых строк для точечной правки.
 * @returns {{ eol: string, preambleRaw: string[], blocks: Array<{ entry: object, raw: string[] }> }}
 */
const scan = (text) => {
  const raws = splitRaw(text);
  const preambleRaw = [];
  /** @type {Array<{ code: string, title: string, start: number, raw: string[] }>} */
  const parts = [];
  const seen = new Map();
  let inFence = false;

  raws.forEach((raw, i) => {
    const line = content(raw);
    const lineNo = i + 1;
    let isHeader = false;
    if (!inFence && line.startsWith('## ')) {
      const m = HEADER_RE.exec(line);
      if (parts.length === 0) {
        isHeader = m !== null && kindByCode(m[1]) !== null;
      } else {
        if (m === null) throw new Error(`AI-SKILLS: строка ${lineNo}: заголовок «${line}» не похож на запись «## <код> · <название>»`);
        if (kindByCode(m[1]) === null) throw new Error(`AI-SKILLS: строка ${lineNo}: неверный код «${m[1]}»`);
        isHeader = true;
      }
      if (isHeader) {
        if (seen.has(m[1])) {
          throw new Error(`AI-SKILLS: строка ${lineNo}: повтор кода ${m[1]} (первый раз — строка ${seen.get(m[1])})`);
        }
        seen.set(m[1], lineNo);
        parts.push({ code: m[1], title: m[2], start: lineNo, raw: [raw] });
      }
    }
    if (!isHeader) {
      if (FENCE_RE.test(line)) inFence = !inFence;
      (parts.length === 0 ? preambleRaw : parts[parts.length - 1].raw).push(raw);
    }
  });

  const blocks = parts.map((p) => ({ entry: makeEntry(p.code, p.title, p.raw, p.start), raw: p.raw }));
  return { eol: detectEol(text), preambleRaw, blocks };
};

/**
 * Разбор текста AI-SKILLS.md.
 * @param {string} text
 * @returns {{ preamble: string, entries: SkillEntry[] }}
 */
export const parseSkills = (text) => {
  const { preambleRaw, blocks } = scan(text);
  const preamble = preambleRaw.map(content).join('\n').replace(/\s+$/, '');
  const entries = blocks.map(({ entry }) => {
    const { hasMeta, ...pub } = entry;
    return pub;
  });
  return { preamble, entries };
};

/**
 * Читает и разбирает файл навыков. Файла нет — пустой набор и rev «none».
 * @param {string} [path]
 * @returns {{ entries: SkillEntry[], rev: string, path: string }}
 */
export const loadSkills = (path = SKILLS_PATH) => {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (err) {
    if (err?.code === 'ENOENT') return { entries: [], rev: 'none', path };
    throw err;
  }
  const rev = createHash('sha256').update(buf).digest('hex').slice(0, 7);
  return { entries: parseSkills(buf.toString('utf8')).entries, rev, path };
};

/** Коды активных записей. */
export const activeCodes = (entries) => new Set(entries.filter((e) => e.status !== 'retired').map((e) => e.code));

/**
 * Текст навыков для промпта: активные записи по перечисленным правилам (у правила сначала rule,
 * затем его exception) и, по запросу, все активные remark. Порядок групп — как в файле, без меты.
 * @param {SkillEntry[]} entries
 * @param {Iterable<string>} ruleCodes
 * @param {{ includeRemarks?: boolean }} [opts]
 * @returns {string}
 */
export const renderSkillsForPrompt = (entries, ruleCodes, { includeRemarks = false } = {}) => {
  const wanted = new Set(ruleCodes);
  /** @type {SkillEntry[][]} */
  const slots = [];
  const groups = new Map();
  for (const e of entries) {
    if (e.status === 'retired') continue;
    if (e.kind === 'remark') {
      if (includeRemarks) slots.push([e]);
      continue;
    }
    if (!wanted.has(e.rule)) continue;
    if (!groups.has(e.rule)) {
      const slot = [];
      groups.set(e.rule, slot);
      slots.push(slot);
    }
    groups.get(e.rule).push(e);
  }
  return slots
    .map((slot) => [...slot.filter((e) => e.kind === 'rule'), ...slot.filter((e) => e.kind !== 'rule')])
    .flat()
    .map((e) => (e.body === '' ? `### ${e.code} · ${e.title}` : `### ${e.code} · ${e.title}\n${e.body}`))
    .join('\n\n');
};

// ---------------------------------------------------------------------------------------------
// Правка

/** Локальная дата ГГГГ-ММ-ДД. */
const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Сколько пустых строк в конце набора сырых строк. */
const trailingBlanks = (raw) => {
  let n = 0;
  while (n < raw.length && isBlank(raw[raw.length - 1 - n])) n += 1;
  return n;
};

/** Гарантирует конец строки у последней строки набора (для дописывания после неё). */
const withFinalEol = (raw, eol) => {
  if (raw.length === 0 || EOL_END_RE.test(raw[raw.length - 1])) return raw;
  return [...raw.slice(0, -1), raw[raw.length - 1] + eol];
};

/** Тело из правки: LF, без пустых строк по краям; ошибка, если оно сломает разбор файла. */
const normalizeBody = (body) => {
  if (typeof body !== 'string') throw new Error('body должен быть строкой');
  const b = body.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (b === '') throw new Error('body пуст');
  if (hasBareH2(b)) throw new Error('в body есть строка, начинающаяся с «## » — она стала бы заголовком записи');
  return b;
};

const normalizeTitle = (title) => {
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) {
    throw new Error('title должен быть непустой однострочной строкой');
  }
  return title.trim();
};

/** Сырые строки записи: заголовок, мета, тело. */
const buildBlock = (code, title, meta, body, eol) =>
  [`## ${code} · ${title}`, metaLine(meta), ...body.split('\n')].map((l) => l + eol);

/** Текст из сегментов (преамбула и записи подряд). */
const joinSegments = (preambleRaw, blocks) => [preambleRaw, ...blocks.map((b) => b.raw)].flat().join('');

/** Замена сырых строк записи по индексу: новый блок + прежние пустые строки после него. */
const rewriteEntry = (scanned, index, newBlock) => {
  const { raw } = scanned.blocks[index];
  const gap = raw.slice(raw.length - trailingBlanks(raw));
  const blocks = scanned.blocks.map((b, i) => (i === index ? { ...b, raw: [...newBlock, ...gap] } : b));
  return joinSegments(scanned.preambleRaw, blocks);
};

/** Вставка нового блока после сегмента afterIndex (-1 — после преамбулы) с пустой строкой-разделителем. */
const insertAfter = (scanned, afterIndex, newBlock) => {
  const { eol, preambleRaw, blocks } = scanned;
  const sep = eol;
  const segs = [preambleRaw, ...blocks.map((b) => b.raw)];
  const at = afterIndex + 1;
  const isLast = at === segs.length - 1;
  const prev = withFinalEol(segs[at], eol);
  const prevGap = trailingBlanks(prev);
  // Между предыдущей записью и новой — пустая строка (в пустой преамбуле она не нужна).
  const prevFixed = prev.length > 0 && prevGap === 0 ? [...prev, sep] : prev;
  const newGap = prevGap > 0 ? prev.slice(prev.length - prevGap) : (isLast ? [] : [sep]);
  const newRaw = [...newBlock, ...newGap];
  const nextSegs = [...segs.slice(0, at), prevFixed, newRaw, ...segs.slice(at + 1)];
  return nextSegs.flat().join('');
};

const findIndex = (scanned, code) => scanned.blocks.findIndex((b) => b.entry.code === code);

const requireEntry = (scanned, code) => {
  const index = typeof code === 'string' ? findIndex(scanned, code) : -1;
  if (index < 0) throw new Error(`запись ${code} не найдена`);
  return { index, entry: scanned.blocks[index].entry };
};

/** Мета для изменяемой записи: её пары как есть, а у записи без меты — значения по умолчанию. */
const baseMeta = (entry) => {
  if (entry.hasMeta) return { ...entry.meta };
  const meta = { kind: entry.kind };
  if (entry.rule !== null) meta.rule = entry.rule;
  meta.status = entry.status;
  meta.auto = entry.auto;
  return meta;
};

const applyAdd = (scanned, edit, today) => {
  const { code, kind } = edit;
  if (!KINDS.includes(kind)) throw new Error(`неизвестный kind «${kind}»`);
  if (typeof code !== 'string' || kindByCode(code) !== kind) throw new Error(`код «${code}» не подходит виду «${kind}»`);
  if (findIndex(scanned, code) >= 0) throw new Error('код уже существует');
  const title = normalizeTitle(edit.title);
  const body = normalizeBody(edit.body);

  let rule = null;
  if (kind === 'rule') rule = code;
  else if (kind === 'exception') rule = code.split('-')[0];
  if (edit.rule !== undefined && edit.rule !== null && edit.rule !== rule) {
    throw new Error(`rule «${edit.rule}» не совпадает с кодом (ожидается ${rule ?? 'без правила'})`);
  }

  const meta = { kind };
  if (rule !== null) meta.rule = rule;
  Object.assign(meta, { status: 'active', auto: 'no', added: today });
  const block = buildBlock(code, title, meta, body, scanned.eol);

  let afterIndex = scanned.blocks.length - 1;
  if (kind === 'exception') {
    for (let i = scanned.blocks.length - 1; i >= 0; i -= 1) {
      if (scanned.blocks[i].entry.rule === rule) {
        afterIndex = i;
        break;
      }
    }
  }
  return insertAfter(scanned, afterIndex, block);
};

const applyReplace = (scanned, edit, today) => {
  const { index, entry } = requireEntry(scanned, edit.code);
  const title = edit.title === undefined ? entry.title : normalizeTitle(edit.title);
  const body = normalizeBody(edit.body);
  const meta = { ...baseMeta(entry), updated: today };
  return rewriteEntry(scanned, index, buildBlock(entry.code, title, meta, body, scanned.eol));
};

const applyRetire = (scanned, edit, today) => {
  const { index, entry } = requireEntry(scanned, edit.code);
  const meta = { ...baseMeta(entry), status: 'retired', retired: today };
  return rewriteEntry(scanned, index, buildBlock(entry.code, entry.title, meta, entry.body, scanned.eol));
};

const applySetAuto = (scanned, edit) => {
  const { index, entry } = requireEntry(scanned, edit.code);
  if (edit.auto === 'yes') throw new Error('auto: yes ставит только человек');
  if (!AUTO_SETTABLE.includes(edit.auto)) throw new Error(`auto «${edit.auto}» недопустим (можно только paused или no)`);
  const meta = { ...baseMeta(entry), auto: edit.auto };
  return rewriteEntry(scanned, index, buildBlock(entry.code, entry.title, meta, entry.body, scanned.eol));
};

const OPS = {
  add: (s, e, today) => applyAdd(s, e, today),
  replace: (s, e, today) => applyReplace(s, e, today),
  retire: (s, e, today) => applyRetire(s, e, today),
  'set-auto': (s, e) => applySetAuto(s, e),
};

/**
 * Применяет правки записей по порядку. Неудачная правка попадает в errors, остальные применяются.
 * Без правок текст возвращается без изменений; нетронутые части файла остаются байт-в-байт.
 * @param {string} text
 * @param {Array<{ op: string, code: string, title?: string, kind?: string, rule?: string, body?: string, auto?: string }>} edits
 * @param {{ today?: string }} [opts] today — ГГГГ-ММ-ДД, по умолчанию локальная дата
 * @returns {{ text: string, applied: string[], errors: string[] }}
 */
export const applySkillEdits = (text, edits, { today } = {}) => {
  const applied = [];
  const errors = [];
  if (!Array.isArray(edits) || edits.length === 0) return { text, applied, errors };
  const date = today ?? localDate();
  let current = text;

  edits.forEach((edit, i) => {
    const label = `${edit?.op ?? '?'} ${edit?.code ?? '?'}`;
    try {
      const run = OPS[edit?.op];
      if (!run) throw new Error(`неизвестная операция «${edit?.op}»`);
      current = run(scan(current), edit, date);
      applied.push(edit.op === 'set-auto' ? `${label} ${edit.auto}` : label);
    } catch (err) {
      errors.push(`правка ${i + 1} (${label}): ${err.message}`);
    }
  });
  return { text: current, applied, errors };
};
