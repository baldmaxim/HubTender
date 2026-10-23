// Проверка ответа модели по таблице фактов, которую вернул prepareBatch (lib/payload.mjs).
// Перенос backend/internal/ai/triage/validate.go. Модуль чистый: ни сети, ни файлов.
//
// Оценка без подтверждённых ссылок на факты сводится к «не уверен» (downgraded).

export const LABEL_LIKELY_ERROR = 'likely_error';
export const LABEL_LIKELY_OK = 'likely_ok';
export const LABEL_UNSURE = 'unsure';

/** Длина причины, которая сохраняется. */
export const MAX_REASON_RUNES = 500;

/** Сколько фактов на оценку сохраняется. */
export const MAX_EVIDENCE = 8;

/** Сколько замечаний на позицию сохраняется. */
export const MAX_REMARKS_PER_POSITION = 3;

/** Длина названия нового типа замечания. */
export const MAX_REMARK_TITLE_RUNES = 120;

/** Тип замечания, не подходящий ни под одну запись навыков. */
export const REMARK_TYPE_NEW = 'NEW';

/** Длиннее — код записи навыков считается выдуманным. */
const MAX_BASIS_LENGTH = 32;

/** Ответ не разобран: не JSON или не по схеме. */
export class InvalidResponseError extends Error {
  constructor(message = 'ответ модели не по схеме') {
    super(message);
    this.name = 'InvalidResponseError';
  }
}

const str = (v) => (v === null || v === undefined ? '' : String(v));

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Строка → число или null: разделители тысяч (пробелы, NBSP, узкие пробелы) убираются, запятая → точка. */
const parseNumber = (s) => {
  const t = s.replace(/[\s   ]/g, '').replace(',', '.');
  return NUMBER_RE.test(t) ? Number(t) : null;
};

/**
 * Значение из ответа совпадает с отправленным. Числа сравниваются как числа
 * («0.050» = «0.05»), текст — с точностью до серий пробелов.
 * @param {unknown} sent
 * @param {unknown} got
 */
export const sameValue = (sent, got) => {
  const a = str(sent).trim();
  const b = str(got).trim();
  if (a === b) return true;
  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na !== null && nb !== null) {
    const diff = Math.abs(na - nb);
    return diff <= 1e-9 || diff <= Math.abs(na) * 1e-9;
  }
  return a.replace(/\s+/g, ' ') === b.replace(/\s+/g, ' ');
};

/** Trim и обрезка по символам Unicode с «…». */
const clipRunes = (s, n) => {
  const t = str(s).trim();
  const chars = Array.from(t);
  return chars.length <= n ? t : `${chars.slice(0, n).join('')}…`;
};

const has = (obj, key) => Object.hasOwn(obj, key);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const parseBasis = (v, knownBasis) => {
  if (typeof v !== 'string') return null;
  const basis = v.trim();
  if (basis === '' || Array.from(basis).length > MAX_BASIS_LENGTH) return null;
  if (knownBasis && !knownBasis.has(basis)) return null;
  return basis;
};

/** Номер из ссылки f12 → 12; для сортировки в числовом порядке. */
const refNumber = (ref) => Number(ref.replace(/^\D+/, '')) || 0;

const checkEvidence = (evidence, facts) => {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (!isObject(e)) continue;
    const ref = str(e.ref).trim();
    if (!has(facts, ref) || seen.has(ref) || !sameValue(facts[ref], e.value)) continue;
    seen.add(ref);
    out.push({ ref, value: facts[ref] });
    if (out.length === MAX_EVIDENCE) break;
  }
  return out;
};

/**
 * Разбирает ответ модели.
 * @param {string | object} answer строгий JSON (строка) или уже разобранный объект
 * @param {{ facts: Record<string, string>, findingRefs: Record<string, string> }} prepared
 * @param {{ knownBasis?: Set<string> }} [opts]
 * @returns {{ assessments: Array<{ findingId: string, label: string, reason: string,
 *   evidence: Array<{ ref: string, value: string }>, downgraded: boolean, basis: string | null }>,
 *   missing: string[] }} missing — находки, пропущенные моделью (в порядке f1, f2, …)
 */
export const validateAnswer = (answer, prepared, { knownBasis } = {}) => {
  let raw = answer;
  if (typeof answer === 'string') {
    try {
      raw = JSON.parse(answer);
    } catch {
      throw new InvalidResponseError();
    }
  }
  if (!isObject(raw) || !Array.isArray(raw.assessments)) throw new InvalidResponseError();

  const { facts, findingRefs } = prepared;
  const got = new Map();
  for (const a of raw.assessments) {
    if (!isObject(a)) continue;
    const ref = str(a.finding).trim();
    if (!has(findingRefs, ref)) continue;
    const findingId = findingRefs[ref];
    if (got.has(findingId)) continue;

    const label = [LABEL_LIKELY_ERROR, LABEL_LIKELY_OK, LABEL_UNSURE].includes(a.label) ? a.label : LABEL_UNSURE;
    const evidence = checkEvidence(a.evidence, facts);
    const downgraded = label !== LABEL_UNSURE && evidence.length === 0;
    got.set(findingId, {
      findingId,
      label: downgraded ? LABEL_UNSURE : label,
      reason: clipRunes(a.reason, MAX_REASON_RUNES),
      evidence,
      downgraded,
      basis: parseBasis(a.basis, knownBasis),
    });
  }

  const assessments = [];
  const missing = [];
  const refs = Object.keys(findingRefs).sort((x, y) => refNumber(x) - refNumber(y));
  for (const ref of refs) {
    const id = findingRefs[ref];
    const a = got.get(id);
    if (a) assessments.push(a);
    else missing.push(id);
  }
  return { assessments, missing };
};

/**
 * Проверяет собственные замечания модели (remarks). Не массив — замечаний нет (не ошибка:
 * ответ в режиме json_object может обойтись без поля). Замечание без подтверждённых фактов,
 * с чужой позицией или строкой, с кодом скриптового правила, дубль и сверх лимита на позицию — отбрасывается.
 * @param {unknown} rawRemarks
 * @param {{ facts: Record<string, string>, positionRefs: Record<string, string>, rowRefs: Record<string, string>,
 *   rowPosition: Record<string, string> }} prepared
 * @param {{ remarkCodes?: Set<string>, ruleCodes?: Set<string> }} [opts]
 *   remarkCodes — активные коды типов замечаний из навыков (AI-001), ruleCodes — коды скриптовых правил
 * @returns {{ remarks: Array<{ type: string, title: string, positionId: string, rowId: string | null, detail: string,
 *   evidence: Array<{ ref: string, value: string }> }>, dropped: number }}
 */
export const validateRemarks = (rawRemarks, prepared, { remarkCodes = new Set(), ruleCodes = new Set() } = {}) => {
  if (!Array.isArray(rawRemarks)) return { remarks: [], dropped: 0 };
  const { facts, positionRefs, rowRefs, rowPosition } = prepared;
  const remarks = [];
  const perPosition = new Map();
  const seen = new Set();
  let dropped = 0;

  for (const r of rawRemarks) {
    const remark = isObject(r) ? parseRemark(r, { facts, positionRefs, rowRefs, rowPosition, remarkCodes, ruleCodes }) : null;
    if (remark === null) {
      dropped += 1;
      continue;
    }
    const key = JSON.stringify([remark.positionId, remark.rowId, remark.type, remark.title]);
    const count = perPosition.get(remark.positionId) ?? 0;
    if (seen.has(key) || count >= MAX_REMARKS_PER_POSITION) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    perPosition.set(remark.positionId, count + 1);
    remarks.push(remark);
  }
  return { remarks, dropped };
};

/** Одно замечание → проверенный вид либо null (отбросить). */
const parseRemark = (r, { facts, positionRefs, rowRefs, rowPosition, remarkCodes, ruleCodes }) => {
  const positionRef = str(r.position).trim();
  if (!has(positionRefs, positionRef)) return null;
  const rowRef = str(r.row).trim();
  if (rowRef !== '' && !(has(rowRefs, rowRef) && rowPosition[rowRef] === positionRef)) return null;

  let type = str(r.type).trim().toUpperCase();
  let title = '';
  if (!remarkCodes.has(type)) {
    if (ruleCodes.has(type)) return null; // дубль скриптового правила
    type = REMARK_TYPE_NEW;
    title = clipRunes(r.title, MAX_REMARK_TITLE_RUNES);
    if (title === '') return null;
  }

  const detail = clipRunes(r.detail, MAX_REASON_RUNES);
  if (detail === '') return null;
  const evidence = checkEvidence(r.evidence, facts);
  if (evidence.length === 0) return null;
  return { type, title, positionId: positionRefs[positionRef], rowId: rowRef === '' ? null : rowRefs[rowRef], detail, evidence };
};
