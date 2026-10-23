// Сборка данных позиций для модели: компактный табличный текст + таблица фактов
// для последующей проверки ответа (lib/validate.mjs). Перенос backend/internal/ai/triage/payload.go.
// Модуль чистый: ни сети, ни файлов.
//
// Модель видит позиции, строки расчёта и находки под короткими сквозными псевдонимами
// (p1, r3, f2) и подкрепляет оценку ссылками вида «r3.conversion_coefficient» со значением,
// дословно взятым из данных. Внутренние id в текст не попадают.

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} [type]
 * @property {string} [name]
 * @property {string} [unit]
 * @property {string} [quantity]
 * @property {string} [conversionCoefficient]
 * @property {string} [consumptionCoefficient]
 * @property {string} [unitRate]
 * @property {string} [currency]
 * @property {string} [total]
 * @property {string} [parentWorkId]
 * @property {string} [costCategory]
 * @property {string} [description]
 *
 * @typedef {object} Position
 * @property {string} id
 * @property {string} [itemNo]
 * @property {string} [customerName]
 * @property {string} [unit]
 * @property {string} [customerVolume]
 * @property {string} [gpVolume]
 * @property {string} [gpNote]
 * @property {string} [clientNote]
 * @property {Row[]} [rows]
 *
 * @typedef {object} Finding
 * @property {string} id
 * @property {string} [ruleCode]
 * @property {string} [ruleTitle]
 * @property {string} [ruleSummary]
 * @property {string} [detail]
 * @property {string} [entityType]
 * @property {string} [entityId]
 * @property {string} [itemId] строка находки у правил по материалу справочника (P, B)
 * @property {string} [positionId]
 * @property {string} [fingerprint]
 *
 * @typedef {{ position: Position, findings: Finding[] }} Item
 *
 * @typedef {object} Prepared
 * @property {string} text
 * @property {Record<string, string>} facts «<ref>.<поле>» → значение, как его видела модель
 * @property {Record<string, string>} findingRefs «f1» → id находки
 * @property {Record<string, string>} positionRefs «p1» → id позиции
 * @property {Record<string, string>} rowRefs «r1» → id строки
 * @property {Record<string, string>} rowPosition «r1» → «p1»: какой позиции принадлежит строка
 * @property {number} estimatedTokens
 */

/** Сколько строк позиции уходит модели. Строки находок и их работы уходят всегда. */
export const MAX_ROWS_PER_POSITION = 60;

/** Длинные тексты режутся: описание строки заказчика бывает на страницу, модели хватает начала. */
export const MAX_TEXT_RUNES = 400;

/** Колонки строк: поле выходного текста → поле входной строки (кроме bound_to_work). */
const ROW_COLUMNS = [
  ['type', 'type', false],
  ['name', 'name', true],
  ['unit', 'unit', false],
  ['quantity', 'quantity', false],
  ['conversion_coefficient', 'conversionCoefficient', false],
  ['consumption_coefficient', 'consumptionCoefficient', false],
  ['unit_rate', 'unitRate', false],
  ['currency', 'currency', false],
  ['total', 'total', false],
  ['bound_to_work', null, false],
  ['cost_category', 'costCategory', true],
  ['description', 'description', true],
];

/** Поля позиции: [поле текста, поле входа, резать ли]. */
const POSITION_FIELDS = [
  ['item_no', 'itemNo', true],
  ['customer_name', 'customerName', true],
  ['unit', 'unit', false],
  ['customer_volume', 'customerVolume', false],
  ['gp_volume', 'gpVolume', false],
  ['gp_note', 'gpNote', true],
  ['client_note', 'clientNote', true],
];

/** Значение из БД → строка: число → String, null/undefined → ''. */
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Обрезка по символам Unicode (не UTF-16), «…» в конце. */
export const clip = (s) => {
  const t = str(s).trim();
  const chars = Array.from(t);
  if (chars.length > MAX_TEXT_RUNES) return `${chars.slice(0, MAX_TEXT_RUNES).join('')}…`;
  return t;
};

/** Очистка значения под табличный формат: переводы строк/табы → пробел, «|» → «/», серии пробелов → один. */
export const cleanText = (s) => str(s).replace(/[\r\n\t]/g, ' ').replace(/\|/g, '/').replace(/ {2,}/g, ' ').trim();

const cleanClip = (s) => clip(cleanText(s));

/** Строка находки: у находки по строке расчёта — её entityId, у остальных — itemId (может не быть). */
const findingRowId = (f) => (f.entityType === 'boq_item' ? str(f.entityId) : str(f.itemId));

/** Оставляет строки находок, их работы и первые строки позиции — до MAX_ROWS_PER_POSITION. */
export const selectRows = (position, findings) => {
  const rows = position.rows ?? [];
  if (rows.length <= MAX_ROWS_PER_POSITION) return rows;
  const byId = new Map(rows.map((r, i) => [r.id, i]));
  const keep = new Set();
  for (const f of findings) {
    const i = byId.get(findingRowId(f));
    if (i === undefined) continue;
    keep.add(i);
    const j = byId.get(rows[i].parentWorkId);
    if (j !== undefined) keep.add(j);
  }
  for (let i = 0; i < rows.length && keep.size < MAX_ROWS_PER_POSITION; i += 1) keep.add(i);
  return [...keep].sort((a, b) => a - b).map((i) => rows[i]);
};

/** Грубая оценка токенов под Qwen: цифры режутся по одной, остальное ~3 символа на токен. */
export const estimateTokens = (s) => {
  let digits = 0;
  let others = 0;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') digits += 1;
    else others += 1;
  }
  return digits + Math.ceil(others / 3);
};

/** Строка таблицы: пустые ячейки — «| |», хвостовые пробелы убираются. */
const tableLine = (cells) => cells.join(' | ').replace(/ {2,}/g, ' ').trimEnd();

/** Колонки строк позиции: пустые у всех — не выводятся; одинаковые у всех (≥ 2 строк) — в rows_common. */
const splitColumns = (rowCells) => {
  const columns = [];
  const common = [];
  for (const [name] of ROW_COLUMNS) {
    const values = rowCells.map((c) => c[name]);
    if (values.every((v) => v === '')) continue;
    if (values.length >= 2 && values[0] !== '' && values.every((v) => v === values[0])) {
      common.push(`${name} = ${values[0]}`);
      continue;
    }
    columns.push(name);
  }
  return { columns, common };
};

/**
 * Собирает один запрос по нескольким позициям. Позиция может быть без находок (findings: []):
 * тогда строки findings: у неё нет, данные нужны модели только для своих замечаний.
 * @param {Item[]} items
 * @returns {Prepared}
 */
export const prepareBatch = (items) => {
  if (!Array.isArray(items) || items.length === 0) throw new Error('пустой пакет');
  /** @type {Record<string, string>} */
  const facts = {};
  const findingRefs = {};
  const positionRefs = {};
  const rowRefs = {};
  const rowPosition = {};
  const fact = (ref, field, value) => {
    if (value !== '') facts[`${ref}.${field}`] = value;
    return value;
  };

  const ruleLines = [];
  const seenRules = new Set();
  const blocks = [];
  let rowNo = 0;
  let findingNo = 0;

  items.forEach((item, pi) => {
    const { position } = item;
    const findings = item.findings ?? [];
    const posRef = `p${pi + 1}`;
    positionRefs[posRef] = position.id;
    const lines = [`## ${posRef}`];

    for (const [name, key, cut] of POSITION_FIELDS) {
      const raw = cut ? cleanClip(position[key]) : cleanText(position[key]);
      const value = fact(posRef, name, raw);
      if (value !== '') lines.push(`${name}: ${value}`);
    }

    const rows = selectRows(position, findings);
    const rowRef = new Map();
    for (const r of rows) {
      rowNo += 1;
      rowRef.set(r.id, `r${rowNo}`);
      rowRefs[`r${rowNo}`] = r.id;
      rowPosition[`r${rowNo}`] = posRef;
    }

    const rowCells = rows.map((r) => {
      const ref = rowRef.get(r.id);
      const cells = {};
      for (const [name, key, cut] of ROW_COLUMNS) {
        if (key === null) {
          const parent = rowRef.get(r.parentWorkId);
          cells[name] = parent ? fact(ref, name, parent) : '';
        } else {
          cells[name] = fact(ref, name, cut ? cleanClip(r[key]) : cleanText(r[key]));
        }
      }
      return cells;
    });

    if (rows.length > 0) {
      const { columns, common } = splitColumns(rowCells);
      if (common.length > 0) lines.push(`rows_common: ${common.join('; ')}`);
      lines.push(`rows: ${tableLine(['ref', ...columns])}`);
      rows.forEach((r, i) => {
        lines.push(tableLine([rowRef.get(r.id), ...columns.map((c) => rowCells[i][c])]));
      });
    }
    const omitted = (position.rows ?? []).length - rows.length;
    if (omitted > 0) lines.push(`rows_omitted: ${omitted}`);

    if (findings.length > 0) lines.push('findings: ref | rule | row | detail');
    for (const f of findings) {
      findingNo += 1;
      const ref = `f${findingNo}`;
      findingRefs[ref] = f.id;
      const code = cleanText(f.ruleCode);
      if (code !== '' && !seenRules.has(code)) {
        seenRules.add(code);
        const title = cleanText(f.ruleTitle);
        const summary = cleanClip(f.ruleSummary);
        const head = title === '' ? code : `${code} — ${/[.!?…]$/.test(title) ? title : `${title}.`}`;
        ruleLines.push(summary === '' ? head : `${head} ${summary}`);
      }
      const detail = fact(ref, 'detail', cleanText(f.detail));
      lines.push(tableLine([ref, code, rowRef.get(findingRowId(f)) ?? '', detail]));
    }
    blocks.push(lines.join('\n'));
  });

  const head = ruleLines.length > 0 ? `Правила:\n${ruleLines.join('\n')}\n\n` : '';
  const text = `${head}${blocks.join('\n\n')}`;
  return { text, facts, findingRefs, positionRefs, rowRefs, rowPosition, estimatedTokens: estimateTokens(text) };
};

/**
 * Делит позиции на группы по бюджету токенов, числу находок и резерву ответа, сохраняя порядок.
 * Позиция, которая одна больше лимитов, идёт отдельной группой.
 * perFindingTokens и perPositionTokens — резерв под ответ: прибавляются к оценке позиции
 * за каждую её находку и за саму позицию (замечания). maxAnswerTokens — потолок суммарного резерва
 * ответа в группе.
 * @param {Item[]} items
 * @param {{ budgetTokens?: number, maxFindings?: number, perFindingTokens?: number, perPositionTokens?: number, maxAnswerTokens?: number }} [opts]
 * @returns {Item[][]}
 */
export const packBatches = (
  items,
  { budgetTokens = 20000, maxFindings = Infinity, perFindingTokens = 0, perPositionTokens = 0, maxAnswerTokens = Infinity } = {},
) => {
  const groups = [];
  let group = [];
  let tokens = 0;
  let count = 0;
  let answer = 0;
  for (const item of items) {
    const n = item.findings.length;
    const reserve = perFindingTokens * n + perPositionTokens;
    const est = prepareBatch([item]).estimatedTokens + reserve;
    if (group.length > 0 && (tokens + est > budgetTokens || count + n > maxFindings || answer + reserve > maxAnswerTokens)) {
      groups.push(group);
      group = [];
      tokens = 0;
      count = 0;
      answer = 0;
    }
    group.push(item);
    tokens += est;
    count += n;
    answer += reserve;
  }
  if (group.length > 0) groups.push(group);
  return groups;
};
