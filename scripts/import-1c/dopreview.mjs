// Excel для ручного разбора ДОП (out/dop-review.xlsx): лист «Не определены» —
// обязательные решения, лист «Проверить» — автопривязки средней надёжности.
// В колонке «Решение»: 1/2/3 — кандидат, номер раздела родителя (как в
// колонке «№ раздела»), «позиция» — загрузить как обычную позицию.
// Пусто на листе «Проверить» — оставить автовыбор. Файл не перезаписывается.

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx/xlsx.mjs';

XLSX.set_fs(fs);

export const DOP_REVIEW_FILE = 'dop-review.xlsx';
const SHEET_REQUIRED = 'Не определены';
const SHEET_CHECK = 'Проверить';
const DECISION = 'Решение';

const candCols = (cands) => {
  const row = {};
  for (let i = 0; i < 3; i += 1) {
    row[`Канд. ${i + 1}: № раздела`] = cands[i]?.section_no ?? '';
    row[`Канд. ${i + 1}: позиция`] = cands[i]?.name ?? '';
  }
  return row;
};

const toSheet = (rows, widths) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  // «Решение» — текстовый формат, иначе Excel превратит «08.02» в число 8.02.
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const header = Object.keys(rows[0] ?? {});
  const col = header.indexOf(DECISION);
  if (col >= 0) {
    for (let r = 1; r <= range.e.r; r += 1) {
      ws[XLSX.utils.encode_cell({ r, c: col })] = { t: 's', v: '', z: '@' };
    }
  }
  ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
};

/** Создаёт out/dop-review.xlsx, если его ещё нет. Возвращает путь или null. */
export const writeDopReview = (outDir, { unresolved, reviewDops }) => {
  const file = path.join(outDir, DOP_REVIEW_FILE);
  if (fs.existsSync(file)) return null;
  const base = (d) => ({
    'Ключ': d.key,
    '№ тендера': d.tender,
    'Версия': d.version,
    'ДОП': d.name,
    '№ раздела ДОП': d.section_no ?? '',
    'Родитель по 1С (parent_line)': d.parent_line ?? '',
  });
  const required = unresolved.map((d) => ({ ...base(d), ...candCols(d.candidates ?? []), [DECISION]: '' }));
  const check = reviewDops.map((d) => ({
    ...base(d),
    'Выбрано автоматически': `${d.parent ?? ''} — ${d.parentName ?? ''} (${d.how})`,
    ...candCols(d.candidates ?? []),
    [DECISION]: '',
  }));
  const help = [
    ['Как заполнить'],
    [`Лист «${SHEET_REQUIRED}» — ДОП, родителя которых не удалось определить. Заполнить «${DECISION}» обязательно.`],
    [`Лист «${SHEET_CHECK}» — привязаны автоматически по косвенным признакам. Пусто — оставить автовыбор.`],
    [`«${DECISION}»: 1, 2 или 3 — выбрать кандидата; номер раздела родителя (например 08.02.07.03);`],
    ['«позиция» — загрузить ДОП как обычную позицию в конце версии (с пометкой «ДОП из 1С без привязки»).'],
    ['Номер раздела должен быть в своей версии тендера; если он повторяется — выбирайте кандидата цифрой.'],
    ['Сохраните файл с тем же именем и повторите прогон загрузчика — решения подхватятся.'],
  ];
  const wb = XLSX.utils.book_new();
  const widths = [10, 9, 7, 45, 14, 35, 12, 35, 12, 35, 12, 35, 14];
  XLSX.utils.book_append_sheet(wb, toSheet(required.length ? required : [{ [DECISION]: '' }], widths), SHEET_REQUIRED);
  XLSX.utils.book_append_sheet(wb, toSheet(check.length ? check : [{ [DECISION]: '' }], [10, 9, 7, 45, 14, 35, 40, ...widths.slice(6)]), SHEET_CHECK);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Как заполнить');
  XLSX.writeFile(wb, file);
  return file;
};

/** Решения из out/dop-review.xlsx в формате dop-map.json. */
export const readDopReview = (outDir) => {
  const file = path.join(outDir, DOP_REVIEW_FILE);
  if (!fs.existsSync(file)) return {};
  const wb = XLSX.readFile(file);
  const out = {};
  for (const name of [SHEET_REQUIRED, SHEET_CHECK]) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    for (const row of XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })) {
      const key = String(row['Ключ'] ?? '').trim();
      const decision = String(row[DECISION] ?? '').trim();
      if (!key || !decision) continue;
      if (/^[123]$/.test(decision)) {
        const section = String(row[`Канд. ${decision}: № раздела`] ?? '').trim();
        if (!section) throw new Error(`${DOP_REVIEW_FILE}: «${key}» — у кандидата ${decision} нет номера раздела`);
        out[key] = { parent: section, name: String(row[`Канд. ${decision}: позиция`] ?? '').trim() || undefined };
      } else if (decision.toLowerCase() === 'позиция') {
        out[key] = 'position';
      } else {
        out[key] = { parent: decision };
      }
    }
  }
  return out;
};
