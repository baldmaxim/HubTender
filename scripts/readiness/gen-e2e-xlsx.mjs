// Этап 2.4 (§14): фикстура XLSX для browser smoke Smart Import.
//   node scripts/readiness/gen-e2e-xlsx.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

const rows = [
  ['№ позиции', 'Тип', 'Наименование', 'Ед. изм.', 'Кол-во', 'Цена за ед.', 'Валюта', 'ID строки', 'Родитель'],
  ['1', 'раб', 'e2e работа', 'м2', 10, 100, 'RUB', 'W1', ''],
  ['1', 'мат', 'e2e материал', 'шт', 5, 50, 'RUB', '', 'W1'],
];
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Смета');
const out = join(process.cwd(), 'tests', 'readiness', 'fixtures', 'e2e-boq.xlsx');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('fixture written:', out);

// Этап 2.6: фикстура пилота — строка БЕЗ точного совпадения номенклатуры
// («Кабель ВВГнг-LS 3х2,5» vs справочник «Кабель ВВГнг(А)-LS 3х2,5») —
// требует AI/ручного подбора перед импортом.
const pilotRows = [
  rows[0],
  ['1', 'раб', 'e2e работа', 'м2', 4, 100, 'RUB', 'W1', ''],
  ['1', 'мат', 'Кабель ВВГнг-LS 3х2,5', 'м', 12, 80, 'RUB', '', 'W1'],
];
const ws2 = XLSX.utils.aoa_to_sheet(pilotRows);
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, ws2, 'Смета');
const out2 = join(process.cwd(), 'tests', 'readiness', 'fixtures', 'e2e-boq-pilot.xlsx');
writeFileSync(out2, XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
console.log('fixture written:', out2);
