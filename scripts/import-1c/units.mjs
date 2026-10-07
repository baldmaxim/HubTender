// Нормализация единиц измерения 1С к кодам справочника units.
// Единицы заказчика — свободный текст, обрезанный 1С до 10 символов
// («м2 прив. п», «кв. м  (п»), поэтому сопоставляем по началу строки.

const clean = (raw) => String(raw ?? '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim();

// Порядок важен: первое совпадение побеждает. Смешанные единицы («шт. / м»)
// отсекаются раньше — по наличию «/».
// \b в JS не работает с кириллицей — конец «слова» задаём явно.
const E = '(?![а-яa-z0-9²³])';
const RULES = [
  [new RegExp(`^(1 )?(м2|м²|кв\\.? ?м${E}|м кв)`), 'м2'],
  [new RegExp(`^(м3|м³|куб\\.? ?м${E}|м\\.? ?куб)`), 'м3'],
  [new RegExp(`^(пог\\.? ?м${E}|п\\.? ?м${E}|м\\.? ?п${E}|мп${E}|м\\.? ?пог)`), 'м.п.'],
  [new RegExp(`^(компл|комп${E}|к-т|к-с|комлп|кмпл)`), 'компл'],
  [new RegExp(`^(шт|ед${E}|штук)`), 'шт'],
  [/^(тн|т|тонн)\.?$/, 'т'],
  [/^кг\.?$/, 'кг'],
  [/^л\.?$/, 'л'],
  [/^м\.?$/, 'м'],
  [/^(мес|мес\.|месяц|мес-ц)$/, 'месяц'],
];

/**
 * Предлагает код единицы для текста 1С или null, если не распознан
 * (смешанные «шт. / м», «%», «0» и т.п. — на ручное решение).
 * @param {string|null} raw
 * @param {Set<string>} knownCodes коды из таблицы units (точное совпадение — сразу)
 */
export const suggestUnitCode = (raw, knownCodes) => {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '' || text === 'NULL') return null;
  if (knownCodes.has(text)) return text;
  const c = clean(text);
  if (knownCodes.has(c)) return c;
  if (c === 'м/п') return 'м.п.';
  if (c.includes('/')) return null;
  for (const [re, code] of RULES) {
    if (re.test(c)) return code;
  }
  return null;
};

/** Похоже на нормальную единицу справочника (её можно завести как новую). */
const looksLikeUnit = (text) => /^[a-zа-яё][a-zа-яё./]{0,11}$/i.test(text) && !/^(\d+|%)$/.test(text);

/**
 * Итоговая карта «текст 1С → код»: ручные решения из units-map.json имеют
 * приоритет над автоподбором. Значение null — оставить без единицы.
 * @param {Map<string, number>} texts текст → число строк
 * @param {Set<string>} knownCodes
 * @param {Record<string, string|null>} overrides
 * @param {{proposeNew?: boolean}} opts proposeNew — неизвестную чистую единицу
 *   предложить завести в справочнике под тем же кодом (для единиц строк 1С)
 */
export const buildUnitMap = (texts, knownCodes, overrides = {}, { proposeNew = false } = {}) => {
  const map = new Map();
  const report = [];
  for (const [text, rows] of texts) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, text);
    let suggested = suggestUnitCode(text, knownCodes);
    if (suggested === null && proposeNew && looksLikeUnit(text)) suggested = text;
    const code = hasOverride ? overrides[text] : suggested;
    const exists = code === null || knownCodes.has(code);
    map.set(text, code);
    report.push({ text, rows, code, source: hasOverride ? 'файл' : 'авто', exists });
  }
  report.sort((a, b) => b.rows - a.rows);
  return { map, report };
};
