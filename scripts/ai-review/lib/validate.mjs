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
